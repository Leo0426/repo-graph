package com.repograph.taint.api;

import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * support language.
 *
 * @author leolu
 * @since 2024/1/22
 */
public enum LanguageEcosystemEnum {
	ABAP("abap", "abap", "ABAP", new String[]{".abap", ".ab4", ".flow", ".asprog"}),
	APEX("apex", "apex", "Apex", new String[]{".cls", ".trigger"}),
	C("c", "cpp", "C", new String[]{".c", ".h"}),
	CPP("cpp", "cpp", "C++", new String[]{".cc", ".cpp", ".cxx", ".c++", ".hh", ".hpp", ".hxx", ".h++", ".ipp"}),
	CS("cs", "csharp", "C#", new String[]{".cs"}),
	CSS("css", "javascript", "CSS", new String[]{".css", ".less", ".scss"}),
	OBJC("objc", "cpp", "Objective-C", new String[]{".m"}),
	COBOL("cobol", "cobol", "COBOL", new String[0]),
	HTML("web", "web", "HTML", new String[]{".html", ".xhtml", ".cshtml", ".vbhtml", ".aspx", ".ascx", ".rhtml", ".erb", ".shtm", ".shtml"}),
	IPYTHON("ipynb", "python", "IPython Notebooks", new String[]{".ipynb"}),
	JAVA("java", "java", "Java", new String[]{".java", ".jav"}),
	JS("js", "javascript", "JavaScript", new String[]{".js", ".jsx", ".vue"}),
	KOTLIN("kotlin", "kotlin", "Kotlin", new String[]{".kt"}),
	PHP("php", "php", "PHP", new String[]{"php", "php3", "php4", "php5", "phtml", "inc"}),
	PLI("pli", "pli", "PL/I", new String[]{".pli"}),
	PLSQL("plsql", "plsql", "PL/SQL", new String[]{".sql", ".pks", ".pkb"}),
	PYTHON("py", "python", "Python", new String[]{".py"}),
	RPG("rpg", "rpg", "RPG", new String[]{".rpg"}),
	RUBY("ruby", "ruby", "Ruby", new String[]{".rb"}),
	SCALA("scala", "scala", "Scala", new String[]{".scala"}),
	SECRETS("secrets", "text", "Secrets", new String[0]),
	SWIFT("swift", "swift", "Swift", new String[]{".swift"}),
	TSQL("tsql", "tsql", "T-SQL", new String[]{".tsql"}),
	TS("ts", "javascript", "TypeScript", new String[]{".ts", ".tsx"}),
	JSP("jsp", "web", "JSP", new String[]{".jsp", ".jspf", ".jspx"}),
	VBNET("vbnet", "vbnet", "VB.NET", new String[]{".vb"}),
	XML("xml", "xml", "XML", new String[]{".xml", ".xsd", ".xsl"}),
	YAML("yaml", "javascript", "YAML", new String[]{".yml", "yaml"}),
	GO("go", "go", "Go", new String[]{".go"}),
	CLOUDFORMATION("cloudformation", "iac", "CloudFormation", new String[0]),
	DOCKER("docker", "iac", "Docker", new String[0]),
	KUBERNETES("kubernetes", "iac", "Kubernetes", new String[0]),
	TERRAFORM("terraform", "iac", "Terraform", new String[]{".tf"});

	private final String languageKey;
	private final String pluginKey;
	private final String[] defaultFileSuffixes;
	private final String label;
	private static final Map<String, LanguageEcosystemEnum> mMap = Collections.unmodifiableMap(initializeMapping());

	private static Map<String, LanguageEcosystemEnum> initializeMapping() {
		Map<String, LanguageEcosystemEnum> mMap = new HashMap<>();
		LanguageEcosystemEnum[] var1 = values();
		for (LanguageEcosystemEnum l : var1) {
			mMap.put(l.languageKey, l);
		}
		return mMap;
	}

	LanguageEcosystemEnum(String languageKey, String pluginKey, String label, String[] defaultFileSuffixes) {
		this.languageKey = languageKey;
		this.pluginKey = pluginKey;
		this.label = label;
		this.defaultFileSuffixes = defaultFileSuffixes;
	}

	public String getLanguageKey() {
		return this.languageKey;
	}

	public String getPluginKey() {
		return this.pluginKey;
	}

	public String getLabel() {
		return this.label;
	}

	public String[] getDefaultFileSuffixes() {
		return this.defaultFileSuffixes;
	}


	public boolean shouldSyncInConnectedMode() {
		return !this.equals(IPYTHON);
	}

	public static Set<LanguageEcosystemEnum> getLanguagesByPluginKey(String pluginKey) {
		return Stream.of(values()).filter((l) -> l.getPluginKey().equals(pluginKey))
			.collect(Collectors.toCollection(LinkedHashSet::new));
	}

	public static boolean containsPlugin(String pluginKey) {
		return Stream.of(values()).anyMatch((l) -> l.getPluginKey().equals(pluginKey));
	}

	public static Optional<LanguageEcosystemEnum> forKey(String languageKey) {
		return Optional.ofNullable((LanguageEcosystemEnum) mMap.get(languageKey));
	}

	public String toString() {
		return this.getLabel();
	}

	private static class Constants {
		public static final String JAVASCRIPT_PLUGIN_KEY = "javascript";

		private Constants() {
		}
	}

}
