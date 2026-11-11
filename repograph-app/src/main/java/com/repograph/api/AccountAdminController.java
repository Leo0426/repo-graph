package com.repograph.api;

import com.repograph.core.identity.Account;
import com.repograph.core.identity.IdentityAuditEvent;
import com.repograph.core.identity.Organization;
import com.repograph.core.identity.ProjectOwner;
import com.repograph.identity.EnterpriseDirectory;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** Administrator account, organization and ownership operations, audited by the directory. @author leolu */
@RestController
@RequestMapping("/api/v1/admin")
public class AccountAdminController {
    private final EnterpriseDirectory directory;
    private final org.springframework.beans.factory.ObjectProvider<com.repograph.core.graph.GraphQueryService> graph;

    /** Creates administrative endpoints. */
    public AccountAdminController(EnterpriseDirectory directory,
            org.springframework.beans.factory.ObjectProvider<com.repograph.core.graph.GraphQueryService> graph) {
        this.directory = directory;
        this.graph = graph;
    }

    /** Lists registered accounts and approval state without password material. */
    @GetMapping("/accounts")
    public List<Account> accounts(@AuthenticationPrincipal Account actor) { return directory.accounts(actor.id()); }

    /** Approves, rejects, disables or reactivates an account with a reason. */
    @PostMapping("/accounts/{id}/review")
    public Account review(@AuthenticationPrincipal Account actor, @PathVariable String id,
                          @RequestBody Review request) {
        return directory.reviewAccount(actor.id(), id, request.status(), request.reason());
    }

    /** Lists managed organizations. */
    @GetMapping("/organizations")
    public List<Organization> organizations(@AuthenticationPrincipal Account actor) {
        return directory.organizations(actor.id());
    }

    /** Creates an organization. */
    @PostMapping("/organizations")
    public Organization createOrganization(@AuthenticationPrincipal Account actor, @RequestBody OrganizationInput input) {
        return directory.createOrganization(actor.id(), input.name());
    }

    /** Renames or enables/disables an organization without deleting data. */
    @PutMapping("/organizations/{id}")
    public Organization updateOrganization(@AuthenticationPrincipal Account actor, @PathVariable String id,
                                           @RequestBody OrganizationInput input) {
        return directory.updateOrganization(actor.id(), id, input.name(), input.active());
    }

    /** Lists organization members including disabled accounts. */
    @GetMapping("/organizations/{id}/members")
    public List<Account> members(@AuthenticationPrincipal Account actor, @PathVariable String id) {
        return directory.members(actor.id(), id);
    }

    /** Adds/removes an organization member. */
    @PutMapping("/organizations/{id}/members/{accountId}")
    public List<Account> membership(@AuthenticationPrincipal Account actor, @PathVariable String id,
                                    @PathVariable String accountId, @RequestBody Membership input) {
        directory.setMembership(actor.id(), id, accountId, input.member());
        return directory.members(actor.id(), id);
    }

    /** Lists known projects with their current ownership; legacy unassigned projects remain visible to admin. */
    @GetMapping("/projects")
    public List<ManagedProject> projects(@AuthenticationPrincipal Account actor) {
        directory.accounts(actor.id()); // Validate administrator before reading the global graph catalog.
        return graph.getObject().listProjects().stream()
                .map(project -> new ManagedProject(project, directory.projectOwner(actor.id(), project.projectId())))
                .toList();
    }

    /** A project and its optional ownership assignment. */
    public record ManagedProject(com.repograph.core.graph.ProjectInfo project, ProjectOwner owner) {}

    /** Assigns project ownership without altering graph or vector IDs. */
    @PutMapping("/projects/{id}/owner")
    public ProjectOwner assign(@AuthenticationPrincipal Account actor, @PathVariable String id,
                               @RequestBody Ownership input) {
        return directory.assignProject(actor.id(), id, input.ownerType(), input.ownerId());
    }

    /** Lists recent management audit events. */
    @GetMapping("/audit")
    public List<IdentityAuditEvent> audit(@AuthenticationPrincipal Account actor,
                                        @RequestParam(defaultValue = "100") int limit) {
        return directory.auditEvents(actor.id(), limit);
    }

    /** Account status change and its mandatory audit reason. */
    public record Review(String status, String reason) {}
    /** Organization editor values. */
    public record OrganizationInput(String name, boolean active) {}
    /** Desired membership state. */
    public record Membership(boolean member) {}
    /** Project ownership target. */
    public record Ownership(String ownerType, String ownerId) {}
}
