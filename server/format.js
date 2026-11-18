'use strict';
const path=require('path');
const parsers={json:'json',jsonc:'json',json5:'json5',java:'java',js:'babel',jsx:'babel',mjs:'babel',cjs:'babel',ts:'typescript',tsx:'typescript',html:'html',htm:'html',vue:'vue',css:'css',scss:'scss',less:'less',md:'markdown',mdx:'mdx',yaml:'yaml',yml:'yaml',xml:'xml',svg:'xml',graphql:'graphql',gql:'graphql'};
module.exports=async function formatFile(relative,content){
  const extension=path.extname(relative).slice(1).toLowerCase();
  const parser=parsers[extension];
  if(!parser) throw new Error('该文件类型暂不支持自动格式化');
  if(Buffer.byteLength(content,'utf8')>2*1024*1024) throw new Error('文件超过 2MB，不支持格式化');
  const prettier=await import('prettier');
  const plugins=[];
  if(parser==='java') plugins.push((await import('prettier-plugin-java')).default);
  if(parser==='xml') plugins.push((await import('@prettier/plugin-xml')).default);
  return prettier.format(content,{parser,plugins,tabWidth:parser==='java'?4:2,printWidth:100,endOfLine:'auto'});
};
