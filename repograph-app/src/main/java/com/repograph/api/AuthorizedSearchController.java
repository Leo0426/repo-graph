package com.repograph.api;

import com.repograph.core.graph.GraphQueryService;
import com.repograph.core.graph.ProjectInfo;
import com.repograph.core.model.CodeUnitKind;
import com.repograph.core.vector.SearchOptions;
import com.repograph.core.vector.SearchPage;
import com.repograph.core.vector.VectorStore;
import com.repograph.identity.EnterpriseDirectory;
import com.repograph.identity.ProjectAccess;
import com.repograph.identity.ProjectAccessConfiguration;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Explicit cross-repository retrieval, constrained before ranking and pagination by current server-side access.
 * @author leolu
 */
@RestController
@RequestMapping("/api/v1/search/authorized")
@ProjectAccess(mode = ProjectAccess.Mode.AUTHENTICATED)
public class AuthorizedSearchController {
    private final VectorStore vectors;
    private final GraphQueryService projects;
    private final EnterpriseDirectory directory;

    /** Creates retrieval using the authoritative project catalog and account directory. */
    public AuthorizedSearchController(VectorStore vectors, GraphQueryService projects, EnterpriseDirectory directory) {
        this.vectors = vectors;
        this.projects = projects;
        this.directory = directory;
    }

    /** Searches natural language within current access; caller-supplied project collections are never trusted. */
    @GetMapping("/semantic")
    public SearchPage semantic(@RequestParam String q, @RequestParam(required = false) String lang,
                               @RequestParam(required = false) CodeUnitKind kind,
                               @RequestParam(defaultValue = "10") int limit,
                               @RequestParam(defaultValue = "0") int offset) {
        return search(q, lang, kind, limit, offset, false);
    }

    /** Searches code similarity within current access with the same server-side pagination semantics. */
    @GetMapping("/code")
    public SearchPage code(@RequestParam String snippet, @RequestParam(required = false) String lang,
                           @RequestParam(defaultValue = "10") int limit,
                           @RequestParam(defaultValue = "0") int offset) {
        return search(snippet, lang, null, limit, offset, true);
    }

    private SearchPage search(String query, String language, CodeUnitKind kind, int limit, int offset, boolean code) {
        var actor = ProjectAccessConfiguration.currentAccount();
        var ids = directory.accessibleProjectIds(actor.id(), projects.listProjects().stream()
                .map(ProjectInfo::projectId).toList());
        var options = new SearchOptions(Math.clamp(limit, 1, 100), Math.max(0, offset), language, kind,
                null, false, false, ids);
        if (ids.isEmpty()) return new SearchPage(java.util.List.of(), options.offset(), options.limit(), false);
        return code ? vectors.codeSearch(query, options) : vectors.semanticSearch(query, options);
    }
}
