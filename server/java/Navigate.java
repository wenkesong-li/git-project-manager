import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import javax.lang.model.element.Element;
import javax.tools.*;
import com.sun.source.tree.*;
import com.sun.source.util.*;

class Navigate {
    static String decode(String value) { return new String(Base64.getDecoder().decode(value), StandardCharsets.UTF_8); }
    static String quote(String value) {
        StringBuilder result = new StringBuilder("\"");
        for (char ch : value.toCharArray()) {
            if (ch == '"' || ch == '\\') result.append('\\').append(ch);
            else if (ch < 32) result.append(String.format("\\u%04x", (int) ch));
            else result.append(ch);
        }
        return result.append('"').toString();
    }
    record Hit(String file, long start, long end, Element element, boolean declaration, CompilationUnitTree unit) {}
    public static void main(String[] args) throws Exception {
        List<String> input = Files.readAllLines(Path.of(args[0]), StandardCharsets.UTF_8).stream().map(Navigate::decode).toList();
        Path root = Path.of(input.get(0)); String action = input.get(1), target = input.get(2), overlay = input.get(5);
        int line = Integer.parseInt(input.get(3)), column = Integer.parseInt(input.get(4));
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        if (compiler == null) throw new IllegalStateException("需要完整 JDK，当前环境只有 JRE");
        try (StandardJavaFileManager manager = compiler.getStandardFileManager(null, null, StandardCharsets.UTF_8)) {
            List<JavaFileObject> documents = new ArrayList<>();
            for (String relative : input.subList(6, input.size())) {
                Path file = root.resolve(relative); String content = relative.equals(target) ? overlay : Files.readString(file, StandardCharsets.UTF_8);
                documents.add(new SimpleJavaFileObject(file.toUri(), JavaFileObject.Kind.SOURCE) { public CharSequence getCharContent(boolean ignore) { return content; } });
            }
            String classpath = String.join(File.pathSeparator, root.resolve("target/classes").toString(), root.resolve("build/classes/java/main").toString(), root.toString());
            List<String> options = new ArrayList<>(List.of("-proc:none", "-classpath", classpath, "-encoding", "UTF-8"));
            if (args.length > 1 && args[1].matches("[0-9]+") && Integer.parseInt(args[1]) >= 8) { options.add("--release"); options.add(args[1]); }
            JavacTask task = (JavacTask) compiler.getTask(new StringWriter(), manager, diagnostic -> {}, options, null, documents);
            List<CompilationUnitTree> units = new ArrayList<>(); task.parse().forEach(units::add);
            try { task.analyze(); } catch (Exception ignored) {}
            Trees trees = Trees.instance(task); SourcePositions positions = trees.getSourcePositions();
            List<Hit> hits = new ArrayList<>();
            for (CompilationUnitTree unit : units) {
                String relative = root.relativize(Path.of(unit.getSourceFile().toUri())).toString().replace('\\', '/');
                String content = unit.getSourceFile().getCharContent(true).toString();
                new TreePathScanner<Void, Void>() {
                    void capture(Tree tree, String name, boolean declaration) {
                        Element element = trees.getElement(getCurrentPath());
                        long begin = positions.getStartPosition(unit, tree), finish = positions.getEndPosition(unit, tree);
                        if (element == null || begin < 0 || finish < begin || finish > content.length() || name.isEmpty()) return;
                        int start = (int) begin, end = (int) finish;
                        if (tree instanceof MemberSelectTree) start = content.lastIndexOf(name, end - 1);
                        else if (declaration) {
                            String fragment = content.substring(start, end);
                            String expression = tree instanceof MethodTree ? "(?<![\\w$])" + Pattern.quote(name) + "\\s*\\(" : tree instanceof ClassTree ? "\\b(?:class|interface|enum|record)\\s+(" + Pattern.quote(name) + ")\\b" : "(?<![\\w$])" + Pattern.quote(name) + "(?![\\w$])";
                            Matcher matcher = Pattern.compile(expression).matcher(fragment);
                            if (!matcher.find()) return;
                            start += tree instanceof ClassTree ? matcher.start(1) : matcher.start();
                        }
                        if (start < begin || start + name.length() > end) return;
                        hits.add(new Hit(relative, start, start + name.length(), element, declaration, unit));
                    }
                    @Override public Void visitIdentifier(IdentifierTree node, Void unused) { capture(node, node.getName().toString(), false); return super.visitIdentifier(node, unused); }
                    @Override public Void visitMemberSelect(MemberSelectTree node, Void unused) { capture(node, node.getIdentifier().toString(), false); return super.visitMemberSelect(node, unused); }
                    @Override public Void visitMethod(MethodTree node, Void unused) { capture(node, node.getName().toString(), true); return super.visitMethod(node, unused); }
                    @Override public Void visitClass(ClassTree node, Void unused) { capture(node, node.getSimpleName().toString(), true); return super.visitClass(node, unused); }
                    @Override public Void visitVariable(VariableTree node, Void unused) { capture(node, node.getName().toString(), true); return super.visitVariable(node, unused); }
                }.scan(unit, null);
            }
            Hit selected = null;
            for (Hit hit : hits) if (hit.file.equals(target)) {
                long offset = hit.unit.getLineMap().getPosition(line, column);
                if (offset >= hit.start && offset <= hit.end && (selected == null || hit.end - hit.start < selected.end - selected.start)) selected = hit;
            }
            List<String> items = new ArrayList<>();
            if (selected != null) for (Hit hit : hits) {
                if (!hit.element.equals(selected.element) || action.equals("definition") && !hit.declaration || action.equals("documentHighlight") && !hit.file.equals(target)) continue;
                LineMap map = hit.unit.getLineMap();
                items.add("{\"path\":" + quote(hit.file) + ",\"range\":{\"start\":{\"line\":" + (map.getLineNumber(hit.start) - 1) + ",\"character\":" + (map.getColumnNumber(hit.start) - 1) + "},\"end\":{\"line\":" + (map.getLineNumber(hit.end) - 1) + ",\"character\":" + (map.getColumnNumber(hit.end) - 1) + "}},\"kind\":1}");
            }
            System.out.print("{\"items\":[" + String.join(",", new LinkedHashSet<>(items)) + "],\"engine\":\"jdk\"}");
        }
    }
}
