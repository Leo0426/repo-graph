package com.repograph.taint.support.framework.spring.annotations;

import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ArrayElementValue;
import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ConstantElementValue;
import com.ibm.wala.shrike.shrikeCT.AnnotationsReader.ElementValue;

public class PutMapping implements IAnnotation {
	private String name;
	private String[] value;
	private String[] path;
	private String[] params;
	private String[] headers;
	private String[] consumes;
	private String[] produces;

	public PutMapping(ElementValue name, ElementValue value, ElementValue path, ElementValue params,
					  ElementValue headers, ElementValue consumes, ElementValue produces) {
		if (value != null) {
			assert value instanceof ArrayElementValue;
			ElementValue[] vals = ((ArrayElementValue) value).vals;
			this.value = new String[vals.length];
			for (int i = 0; i < vals.length; i++) {
				ElementValue subVal = vals[i];
				assert subVal instanceof ConstantElementValue;
				this.value[i] = subVal.toString();
			}
		}
		if (path != null) {
			assert path instanceof ArrayElementValue;
			ElementValue[] vals = ((ArrayElementValue) path).vals;
			this.path = new String[vals.length];
			for (int i = 0; i < vals.length; i++) {
				ElementValue subVal = vals[i];
				assert subVal instanceof ConstantElementValue;
				this.path[i] = subVal.toString();
			}
		}
		// TODO handle other args
	}

	/**
	 * Assign a name to this mapping.
	 * <p>
	 * <b>Supported at the type level as well as at the method level!</b> When used
	 * on both levels, a combined name is derived by concatenation with "#" as
	 * separator.
	 */
	public String name() {
		return name;
	}

	/**
	 * The primary mapping expressed by this annotation.
	 * <p>
	 * In a Servlet environment this is an alias for {@link #path}. For example
	 * {@code @RequestMapping("/foo")} is equivalent to
	 * {@code @RequestMapping(path="/foo")}.
	 * <p>
	 * In a Portlet environment this is the mapped portlet modes (i.e. "EDIT",
	 * "VIEW", "HELP" or any custom modes).
	 * <p>
	 * <b>Supported at the type level as well as at the method level!</b> When used
	 * at the type level, all method-level mappings inherit this primary mapping,
	 * narrowing it for a specific handler method.
	 */
	public String[] value() {
		return value;
	}

	/**
	 * In a Servlet environment only: the path mapping URIs (e.g. "/myPath.do").
	 * Ant-style path patterns are also supported (e.g. "/myPath/*.do"). At the
	 * method level, relative paths (e.g. "edit.do") are supported within the
	 * primary mapping expressed at the type level. Path mapping URIs may contain
	 * placeholders (e.g. "/${connect}")
	 * <p>
	 * <b>Supported at the type level as well as at the method level!</b> When used
	 * at the type level, all method-level mappings inherit this primary mapping,
	 * narrowing it for a specific handler method.
	 *
	 * @since 4.2
	 */
	public String[] path() {
		return path;
	}

	/**
	 * The parameters of the mapped request, narrowing the primary mapping.
	 * <p>
	 * Same format for any environment: a sequence of "myParam=myValue" style
	 * expressions, with a request only mapped if each such parameter is found to
	 * have the given value. Expressions can be negated by using the "!=" operator,
	 * as in "myParam!=myValue". "myParam" style expressions are also supported,
	 * with such parameters having to be present in the request (allowed to have any
	 * value). Finally, "!myParam" style expressions indicate that the specified
	 * parameter is <i>not</i> supposed to be present in the request.
	 * <p>
	 * <b>Supported at the type level as well as at the method level!</b> When used
	 * at the type level, all method-level mappings inherit this parameter
	 * restriction (i.e. the type-level restriction gets checked before the handler
	 * method is even resolved).
	 * <p>
	 * In a Servlet environment, parameter mappings are considered as restrictions
	 * that are enforced at the type level. The primary path mapping (i.e. the
	 * specified URI value) still has to uniquely identify the target handler, with
	 * parameter mappings simply expressing preconditions for invoking the handler.
	 * <p>
	 * In a Portlet environment, parameters are taken into account as mapping
	 * differentiators, i.e. the primary portlet mode mapping plus the parameter
	 * conditions uniquely identify the target handler. Different handlers may be
	 * mapped onto the same portlet mode, as long as their parameter mappings
	 * differ.
	 */
	public String[] params() {
		return params;
	}

	/**
	 * The headers of the mapped request, narrowing the primary mapping.
	 * <p>
	 * Same format for any environment: a sequence of "My-Header=myValue" style
	 * expressions, with a request only mapped if each such header is found to have
	 * the given value. Expressions can be negated by using the "!=" operator, as in
	 * "My-Header!=myValue". "My-Header" style expressions are also supported, with
	 * such headers having to be present in the request (allowed to have any value).
	 * Finally, "!My-Header" style expressions indicate that the specified header is
	 * <i>not</i> supposed to be present in the request.
	 * <p>
	 * Also supports media type wildcards (*), for headers such as Accept and
	 * Content-Type. For instance,
	 *
	 * <pre class="code">
	 * &#064;RequestMapping(value = "/something", headers = "content-type=text/*")
	 * </pre>
	 * <p>
	 * will match requests with a Content-Type of "text/html", "text/plain", etc.
	 * <p>
	 * <b>Supported at the type level as well as at the method level!</b> When used
	 * at the type level, all method-level mappings inherit this header restriction
	 * (i.e. the type-level restriction gets checked before the handler method is
	 * even resolved).
	 * <p>
	 * Maps against HttpServletRequest headers in a Servlet environment, and against
	 * PortletRequest properties in a Portlet 2.0 environment.
	 */
	public String[] headers() {
		return headers;
	}

	/**
	 * The consumable media types of the mapped request, narrowing the primary
	 * mapping.
	 * <p>
	 * The format is a single media type or a sequence of media types, with a
	 * request only mapped if the {@code Content-Type} matches one of these media
	 * types. Examples:
	 *
	 * <pre class="code">
	 * consumes = "text/plain"
	 * consumes = {"text/plain", "application/*"}
	 * </pre>
	 * <p>
	 * Expressions can be negated by using the "!" operator, as in "!text/plain",
	 * which matches all requests with a {@code Content-Type} other than
	 * "text/plain".
	 * <p>
	 * <b>Supported at the type level as well as at the method level!</b> When used
	 * at the type level, all method-level mappings override this consumes
	 * restriction.
	 */
	public String[] consumes() {
		return consumes;
	}

	/**
	 * The producible media types of the mapped request, narrowing the primary
	 * mapping.
	 * <p>
	 * The format is a single media type or a sequence of media types, with a
	 * request only mapped if the {@code Accept} matches one of these media types.
	 * Examples:
	 *
	 * <pre class="code">
	 * produces = "text/plain"
	 * produces = {"text/plain", "application/*"}
	 * </pre>
	 * <p>
	 * Expressions can be negated by using the "!" operator, as in "!text/plain",
	 * which matches all requests with a {@code Accept} other than "text/plain".
	 * <p>
	 * <b>Supported at the type level as well as at the method level!</b> When used
	 * at the type level, all method-level mappings override this produces
	 * restriction.
	 */
	public String[] produces() {
		return produces;
	}
}
