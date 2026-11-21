import { editorColors } from './editor-palette';
import React, {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {EditorState,Compartment,Prec,StateEffect,StateField} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,highlightActiveLineGutter,drawSelection,dropCursor,rectangularSelection,crosshairCursor,hoverTooltip,Decoration} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab,undo,redo,toggleLineComment} from '@codemirror/commands';
import {foldGutter,foldKeymap,indentOnInput,bracketMatching,syntaxHighlighting,HighlightStyle,indentUnit,foldAll,unfoldAll} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {autocompletion,completionKeymap,startCompletion,closeBrackets,closeBracketsKeymap} from '@codemirror/autocomplete';
import {search,searchKeymap,highlightSelectionMatches,openSearchPanel,gotoLine} from '@codemirror/search';
import {tags} from '@lezer/highlight';
import {post} from './api';
import {languageInfo} from './editor-language';
import {readPreferences} from './preferences';
import {Message} from './ui-kit';
import { defaults, displayKey } from './shortcut-config';

const semanticMarks=StateEffect.define();
const marksField=StateField.define({create:()=>Decoration.none,update(value,transaction){value=value.map(transaction.changes);for(const effect of transaction.effects)if(effect.is(semanticMarks))value=effect.value;return value;},provide:field=>EditorView.decorations.from(field)});
const tokenStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword, tags.operatorKeyword, tags.definitionKeyword, tags.moduleKeyword], color: 'var(--code-keyword)', fontWeight: '600' },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--code-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--code-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: 'var(--code-comment)', fontStyle: 'italic' },
  { tag: [tags.typeName, tags.className, tags.standard(tags.typeName), tags.tagName], color: 'var(--code-type)' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: 'var(--code-function)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--code-property)' },
]);
const menuBindings = { "editor.action.revealDefinition": "definition", toggleComment: "comment", foldAll: "fold", unfoldAll: "unfold" };
function menuShortcut(id) {
  const action = menuBindings[id] || id;
  const keys = readPreferences().shortcuts[action] ?? defaults[action];
  return keys?.[0] ? displayKey(keys[0]) : "";
}
const theme=EditorView.theme({
  '&':{height:'100%',color:'var(--code-foreground)',backgroundColor:'var(--code-surface-background, var(--code-background))'},
  '.cm-scroller':{fontFamily:'"Cascadia Code",Consolas,monospace',overflow:'auto'},
  '.cm-content':{padding:'10px 0 24px',caretColor:'var(--code-foreground)'},
  '.cm-gutters':{backgroundColor:'color-mix(in srgb, var(--code-surface-background, var(--code-background)) 95%, var(--code-foreground))',color:'var(--code-comment)',borderRight:'1px solid var(--line)'},
  '.cm-activeLine,.cm-activeLineGutter':{backgroundColor:'color-mix(in srgb, var(--code-surface-background, var(--code-background)) 92%, var(--code-foreground))'},
  '.cm-selectionBackground,&.cm-focused .cm-selectionBackground,::selection':{backgroundColor:'var(--code-selection)'},
  '.cm-cursor':{borderLeftColor:'var(--code-foreground)'},
  '.cm-panels,.cm-tooltip':{backgroundColor:'var(--code-background)',color:'var(--code-foreground)',border:'1px solid var(--line)'},
  '.cm-panel input,.cm-panel button':{color:'var(--code-foreground)',backgroundColor:'var(--code-background)',border:'1px solid var(--line)',borderRadius:'3px'},
  '.cm-searchMatch,.cm-selectionMatch':{backgroundColor:'var(--code-selection)'},
  '.cm-tooltip-autocomplete ul li[aria-selected]':{backgroundColor:'var(--code-selection)',color:'var(--code-foreground)'},
});
function offset(doc,line=1,column=1){const row=doc.line(Math.max(1,Math.min(doc.lines,Number(line)||1)));return Math.min(row.to,row.from+Math.max(0,(Number(column)||1)-1));}
function position(view){const head=view.state.selection.main.head,line=view.state.doc.lineAt(head);return {lineNumber:line.number,column:head-line.from+1};}
export default forwardRef(function CodeEditor({value,path,projectId,readOnly=false,disabled=false,onChange,onSelection,onSave,onFormat,onNativeCopy,onNavigate,location,onPosition,onReferences},ref){
  const host=useRef(null),editor=useRef(null),callbacks=useRef({}),actions=useRef({});
  const [menu,setMenu]=useState(null);
  callbacks.current={onChange,onSelection,onSave,onFormat,onNativeCopy,onNavigate,onPosition,onReferences};
  useEffect(()=>{const dismiss=event=>{if(event.type==="keydown" && event.key!=="Escape")return;if(event.type==="pointerdown" && event.target.closest?.(".editor-context-menu"))return;setMenu(null);};window.addEventListener("pointerdown",dismiss);window.addEventListener("keydown",dismiss);return()=>{window.removeEventListener("pointerdown",dismiss);window.removeEventListener("keydown",dismiss);};},[]);
  const config=useRef({language:new Compartment(),preferences:new Compartment(),editable:new Compartment(),shortcuts:new Compartment()});
  useImperativeHandle(ref,()=>({getText:()=>editor.current?.state.sliceDoc() || '',getPosition:()=>editor.current?position(editor.current):{lineNumber:1,column:1},getSelection:()=>editor.current?.state.selection.ranges.map(range=>editor.current.state.sliceDoc(range.from,range.to)).join('\n') || '',focus:()=>editor.current?.focus(),action:id=>actions.current[id]?.()}),[]);
  useEffect(()=>{
    setMenu(null);
    let alive=true,request=0,highlightTimer,highlightRequest=0;const info=languageInfo(path),compartments=config.current;
    const semantic=['java','javascript','typescript'].includes(info.mode);
    function preferenceExtensions(){
      const prefs = readPreferences().editor;
      const variables = Object.fromEntries(Object.entries(editorColors(prefs)).map(([role, color]) => ['--code-' + role, color]));
      return [EditorView.theme({'&':{...variables,fontSize:`${prefs.fontSize}px`},'.cm-content':{lineHeight:'1.75'}}),prefs.wordWrap?EditorView.lineWrapping:[],prefs.lineNumbers!==false?[lineNumbers(),highlightActiveLineGutter()]:[]];}
    async function query(action,at,view){return post(`/api/local/${projectId}/${info.mode==='java'?'java':'script'}-intelligence`,{path,content:view.state.sliceDoc(),line:at.lineNumber,column:at.column,action});}
    async function definition(view=editor.current,at=position(view)){
      const ticket=++request,document=view.state.doc;
      try{
        const row=document.line(at.lineNumber),column=at.column-1;
        const matches=[...row.text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*|@import\s*)['"]([^'"\r\n]+)['"]/g)];
        const imported=matches.find(match=>{const start=match.index+match[0].indexOf(match[1]);return column>=start && column<=start+match[1].length;});
        if(imported){const data=await post(`/api/local/${projectId}/resolve-imports`,{path,specifiers:[imported[1]]});if(!alive || ticket!==request || view.state.doc!==document)return;if(data.items[0])return callbacks.current.onNavigate?.({path:data.items[0].path,line:1,column:1});}
        if(!semantic){Message.info('当前位置没有可跳转的工程符号');return;}
        const data=await query('definition',at,view);if(!alive || ticket!==request || view.state.doc!==document)return;
        const item=data.items?.[0];if(item)callbacks.current.onNavigate?.({path:item.path,line:item.range.start.line+1,column:item.range.start.character+1});else Message.info('没有找到定义');
      }catch(error){if(alive)Message.error(error.message);}
    }
    const run=(callback)=>()=>{callback?.();return true;};
    function toggleCase(view) {
      if (view.state.readOnly) return false;
      const selected = view.state.selection.ranges.filter(range => !range.empty);
      if (!selected.length) return false;
      const text = selected.map(range => view.state.sliceDoc(range.from, range.to)).join('');
      const upper = text === text.toUpperCase();
      view.dispatch({ changes: selected.map(range => {
        const value = view.state.sliceDoc(range.from, range.to);
        return { from: range.from, to: range.to, insert: upper ? value.toLowerCase() : value.toUpperCase() };
      }) });
      return true;
    }
    const commands = {
      save: run(() => callbacks.current.onSave?.()),
      format: run(() => callbacks.current.onFormat?.()),
      definition: run(() => definition()),
      references: run(() => callbacks.current.onReferences?.()),
      find: openSearchPanel, gotoLine, fold: foldAll, unfold: unfoldAll,
      completion: startCompletion, toggleCase, undo, redo, comment: toggleLineComment,
    };
    const managedCommands = new Set(Object.values(commands));
    function shortcutExtensions() {
      const overrides = readPreferences().shortcuts;
      return Prec.highest(keymap.of(Object.entries(commands).flatMap(([id, command]) =>
        (overrides[id] ?? defaults[id]).map(key => ({ key, run: command, preventDefault: true }))
      )));
    }
    const state=EditorState.create({doc:value,extensions:[
      theme,marksField,syntaxHighlighting(tokenStyle),history(),drawSelection(),dropCursor(),rectangularSelection(),crosshairCursor(),
      indentOnInput(),bracketMatching(),foldGutter(),closeBrackets(),autocompletion(),
      ["javascript","typescript"].includes(info.mode)?autocompletion({override:[async context=>{const word=context.matchBefore(/\w*/);if(!word || !context.explicit && !word.text)return null;if(!context.explicit)await new Promise(resolve=>setTimeout(resolve,200));if(!alive || context.aborted)return null;const row=context.state.doc.lineAt(context.pos),snapshot=context.state.doc;try{const data=await post(`/api/local/${projectId}/script-intelligence`,{path,content:context.state.sliceDoc(),action:"completion",line:row.number,column:context.pos-row.from+1});if(!alive || context.aborted || editor.current?.state.doc!==snapshot)return null;return {from:word.from,options:data.items,validFor:/^\w*$/};}catch{return null;}}]}):[],highlightActiveLine(),highlightSelectionMatches(),search({top:true}),
      EditorState.phrases.of({'Find':'查找','Replace':'替换','next':'下一个','previous':'上一个','all':'全选匹配','match case':'区分大小写','regexp':'正则','by word':'完整单词','replace':'替换当前','replace all':'全部替换','close':'关闭','Go to line:':'跳转行号：','go':'跳转','Fold line':'折叠此行','Unfold line':'展开此行'}),EditorState.lineSeparator.of(value.includes('\r\n')?'\r\n':'\n'),EditorState.allowMultipleSelections.of(true),EditorState.tabSize.of(info.indent),indentUnit.of(' '.repeat(info.indent)),
      compartments.language.of([]),compartments.preferences.of(preferenceExtensions()),compartments.editable.of([EditorState.readOnly.of(readOnly || disabled),EditorView.editable.of(!disabled)]),
      EditorView.contentAttributes.of({'aria-label':`文件内容 ${path}`,'aria-readonly':String(readOnly)}),
      compartments.shortcuts.of(shortcutExtensions()),
      keymap.of([...closeBracketsKeymap,...defaultKeymap,...historyKeymap,...searchKeymap,...foldKeymap,...completionKeymap,indentWithTab]
        .filter(binding => !managedCommands.has(binding.run) && !managedCommands.has(binding.shift))),
      semantic?hoverTooltip(async(view,pos)=>{try{const doc=view.state.doc,row=doc.lineAt(pos),data=await query('hover',{lineNumber:row.number,column:pos-row.from+1},view);if(!alive || view.state.doc!==doc || !data.result)return null;const contents=data.result.contents,text=(Array.isArray(contents)?contents:[contents]).map(item=>typeof item==='string'?item:item?.value || '').join('\n');if(!text)return null;return {pos,create(){const dom=document.createElement('pre');dom.textContent=text;dom.className='editor-hover-text';return {dom};}};}catch{return null;}}):[],
      EditorView.domEventHandlers({click(event,view){setMenu(null);if(!(event.ctrlKey || event.metaKey))return false;const pos=view.posAtCoords({x:event.clientX,y:event.clientY});if(pos==null)return false;const row=view.state.doc.lineAt(pos);definition(view,{lineNumber:row.number,column:pos-row.from+1});return true;},contextmenu(event){event.preventDefault();const box=host.current.getBoundingClientRect();setMenu({x:Math.max(0,Math.min(event.clientX-box.left,box.width-180)),y:Math.max(0,Math.min(event.clientY-box.top,box.height-220))});return true;},copy(){callbacks.current.onNativeCopy?.();return false;},focus(){announce(editor.current);return false;}}),
      EditorView.updateListener.of(update=>{if(update.docChanged)callbacks.current.onChange?.(update.state.sliceDoc());if(update.docChanged || update.selectionSet)announce(update.view);}),
    ]});
    function announce(view){if(!view)return;const at=position(view),selection=view.state.selection.main;callbacks.current.onSelection?.(!selection.empty);callbacks.current.onPosition?.({path,line:at.lineNumber,column:at.column});clearTimeout(highlightTimer);const ticket=++highlightRequest,document=view.state.doc;if(semantic)highlightTimer=setTimeout(async()=>{try{const data=await query('documentHighlight',at,view);if(!alive || ticket!==highlightRequest || view.state.doc!==document)return;const items=info.mode==='java'?data.result || []:data.items || [];const marks=items.filter(item=>!item.path || item.path===path).flatMap(item=>{const from=offset(document,item.range.start.line+1,item.range.start.character+1),to=offset(document,item.range.end.line+1,item.range.end.character+1);return to>from?[Decoration.mark({class:'cm-semantic-reference'}).range(from,to)]:[];});view.dispatch({effects:semanticMarks.of(Decoration.set(marks,true))});}catch{}},450);window.dispatchEvent(new CustomEvent('gitpm:editor-status',{detail:{projectId,path,language:info.label,line:at.lineNumber,column:at.column,indent:info.indent,selected:view.state.selection.ranges.reduce((sum,range)=>sum+range.to-range.from,0),readOnly,ending:value.includes('\r\n')?'CRLF':'LF'}}));}
    const view=new EditorView({state,parent:host.current});editor.current=view;
    actions.current={'editor.action.revealDefinition':()=>definition(),find:()=>openSearchPanel(view),gotoLine:()=>gotoLine(view),undo:()=>undo(view),redo:()=>redo(view),toggleComment:()=>toggleLineComment(view),foldAll:()=>foldAll(view),unfoldAll:()=>unfoldAll(view),format:()=>callbacks.current.onFormat?.(),references:()=>callbacks.current.onReferences?.(),save:()=>callbacks.current.onSave?.()};
    const descriptor=languages.find(item=>item.extensions.includes(info.ext));if(descriptor)descriptor.load().then(support=>{if(alive)view.dispatch({effects:compartments.language.reconfigure(support)});}).catch(()=>{if(alive)Message.warning('语言支持加载失败，可重新打开文件');});
    const preferences=()=>view.dispatch({effects:[compartments.preferences.reconfigure(preferenceExtensions()),compartments.shortcuts.reconfigure(shortcutExtensions())]});
    const command=event=>{if(document.activeElement===view.contentDOM || host.current.contains(document.activeElement) || event.detail?.path===path){actions.current[event.detail?.action]?.();}};
    window.addEventListener('gitpm:preferences',preferences);window.addEventListener('gitpm:editor-command',command);announce(view);
    return()=>{alive=false;request++;clearTimeout(highlightTimer);view.destroy();editor.current=null;window.removeEventListener('gitpm:preferences',preferences);window.removeEventListener('gitpm:editor-command',command);window.dispatchEvent(new CustomEvent('gitpm:editor-status',{detail:null}));};
  },[projectId,path,readOnly]);
  useEffect(()=>{const view=editor.current;if(view && view.state.sliceDoc()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});},[value]);
  useEffect(()=>{editor.current?.dispatch({effects:config.current.editable.reconfigure([EditorState.readOnly.of(readOnly || disabled),EditorView.editable.of(!disabled)])});},[disabled,readOnly]);
  useEffect(()=>{const view=editor.current;if(view && location){const anchor=offset(view.state.doc,location.line,location.column);view.dispatch({selection:{anchor},effects:EditorView.scrollIntoView(anchor,{y:'center'})});view.focus();}},[location]);
  return <div className={`code-editor-host codemirror-host ${readOnly?'readonly':''}`} ref={host}>{menu && <div className="editor-context-menu" role="menu" aria-label="编辑器操作" style={{left:menu.x,top:menu.y}} onKeyDown={event=>{if(event.key==='Escape')setMenu(null);}}>{[['editor.action.revealDefinition','转到定义','F12'],['references','查找引用','Shift F12'],['find','查找 / 替换','Ctrl F'],['gotoLine','跳转行号','Ctrl G'],['format','格式化','Ctrl Alt L'],['toggleComment','切换注释','Ctrl /'],['foldAll','折叠代码',''],['unfoldAll','展开代码',''],['save','保存','Ctrl S']].map(([id,label])=><button role="menuitem" key={id} disabled={readOnly && ['format','toggleComment','save'].includes(id)} onClick={()=>{setMenu(null);editor.current?.focus();actions.current[id]?.();}}>{label}<kbd>{menuShortcut(id)}</kbd></button>)}</div>}</div>;
});
