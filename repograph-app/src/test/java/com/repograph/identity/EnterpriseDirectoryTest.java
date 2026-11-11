package com.repograph.identity;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Account approval contract against a real SQLite database. @author leolu */
class EnterpriseDirectoryTest {
    @TempDir Path directory;

    @Test
    void registrationRequiresAdministratorApprovalAndSurvivesRestart() {
        String path = directory.resolve("enterprise.db").toString();
        var accounts = new EnterpriseDirectory(path);
        var admin = accounts.bootstrapAdmin("Initial-admin-password-2026");
        var pending = accounts.register("alice", "Alice", "alice@example.test", "User-password-2026");

        assertThat(pending.status()).isEqualTo("PENDING");
        assertThat(pending.role()).isEqualTo("USER");
        assertThatThrownBy(() -> accounts.authenticate("alice", "User-password-2026"))
                .isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> accounts.reviewAccount(pending.id(), pending.id(), "ACTIVE", "self approval"))
                .isInstanceOf(IdentityException.class);

        accounts.reviewAccount(admin.id(), pending.id(), "ACTIVE", "Employee verified");
        var reopened = new EnterpriseDirectory(path);
        assertThat(reopened.authenticate("alice", "User-password-2026").id()).isEqualTo(pending.id());
        assertThat(reopened.bootstrapAdmin("Replacement-password-2026").id()).isEqualTo(admin.id());
        assertThat(reopened.authenticate("admin", "Initial-admin-password-2026").role()).isEqualTo("ADMIN");
        assertThatThrownBy(() -> reopened.authenticate("admin", "Replacement-password-2026"))
                .isInstanceOf(IdentityException.class);
    }
    @Test
    void disablingAndChangingPasswordInvalidateOldSessions() {
        var accounts = new EnterpriseDirectory(directory.resolve("sessions.db").toString());
        var admin = accounts.bootstrapAdmin("Initial-admin-password-2026");
        var pending = accounts.register("alice", "Alice", "alice@example.test", "User-password-2026");
        accounts.reviewAccount(admin.id(), pending.id(), "ACTIVE", "Approved");
        var first = accounts.authenticate("alice", "User-password-2026");
        assertThat(accounts.validateSession(first.id(), first.credentialVersion()).id()).isEqualTo(first.id());
        accounts.reviewAccount(admin.id(), first.id(), "DISABLED", "Access removed");
        assertThatThrownBy(() -> accounts.validateSession(first.id(), first.credentialVersion()))
                .isInstanceOf(IdentityException.class);
        accounts.reviewAccount(admin.id(), first.id(), "ACTIVE", "Access restored");
        assertThatThrownBy(() -> accounts.validateSession(first.id(), first.credentialVersion()))
                .isInstanceOf(IdentityException.class);
        var restored = accounts.authenticate("alice", "User-password-2026");
        accounts.changePassword(restored.id(), "User-password-2026", "Changed-password-2026");
        assertThatThrownBy(() -> accounts.validateSession(restored.id(), restored.credentialVersion()))
                .isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> accounts.authenticate("alice", "User-password-2026"))
                .isInstanceOf(IdentityException.class);
        assertThat(accounts.authenticate("alice", "Changed-password-2026").id()).isEqualTo(first.id());
        assertThatThrownBy(() -> accounts.reviewAccount(admin.id(), admin.id(), "DISABLED", "attempt"))
                .isInstanceOf(IdentityException.class);
    }

    @Test
    void projectOwnershipSeparatesPersonalAndOrganizationAccessAndRevokesMembershipImmediately() {
        var accounts = new EnterpriseDirectory(directory.resolve("ownership.db").toString());
        var admin = accounts.bootstrapAdmin("Initial-admin-password-2026");
        var alice = accounts.register("alice", "Alice", "alice@example.test", "Alice-password-2026");
        var bob = accounts.register("bobby", "Bob", "bob@example.test", "Bobby-password-2026");
        accounts.reviewAccount(admin.id(), alice.id(), "ACTIVE", "Approved");
        accounts.reviewAccount(admin.id(), bob.id(), "ACTIVE", "Approved");
        var team = accounts.createOrganization(admin.id(), "Security Engineering");
        accounts.setMembership(admin.id(), team.id(), alice.id(), true);
        accounts.assignProject(admin.id(), "012345abcdef", "PERSONAL", bob.id());
        assertThat(accounts.canAccessProject(bob.id(), "012345abcdef")).isTrue();
        assertThat(accounts.canAccessProject(alice.id(), "012345abcdef")).isFalse();
        assertThat(accounts.canAccessProject(alice.id(), "000000000000")).isFalse();
        assertThat(accounts.canAccessProject(admin.id(), "000000000000")).isTrue();
        assertThatThrownBy(() -> accounts.assignProject(alice.id(), "012345abcdef", "PERSONAL", alice.id()))
                .isInstanceOf(IdentityException.class);
        accounts.assignProject(admin.id(), "012345abcdef", "ORGANIZATION", team.id());
        assertThat(accounts.canAccessProject(bob.id(), "012345abcdef")).isFalse();
        assertThat(accounts.canAccessProject(alice.id(), "012345abcdef")).isTrue();
        accounts.setMembership(admin.id(), team.id(), alice.id(), false);
        assertThat(accounts.canAccessProject(alice.id(), "012345abcdef")).isFalse();
        assertThat(new EnterpriseDirectory(directory.resolve("ownership.db").toString())
                .projectOwner(admin.id(), "012345abcdef").ownerId()).isEqualTo(team.id());
    }

    @Test
    void disablingAnOrganizationRevokesAccessWithoutLosingOwnershipAndRecordsAdministrativeActions() {
        var accounts = new EnterpriseDirectory(directory.resolve("audit.db").toString());
        var admin = accounts.bootstrapAdmin("Initial-admin-password-2026");
        var user = accounts.register("alice", "Alice", "alice@example.test", "Alice-password-2026");
        accounts.reviewAccount(admin.id(), user.id(), "ACTIVE", "Approved");
        var team = accounts.createOrganization(admin.id(), "Security");
        accounts.setMembership(admin.id(), team.id(), user.id(), true);
        accounts.assignProject(admin.id(), "012345abcdef", "ORGANIZATION", team.id());
        accounts.updateOrganization(admin.id(), team.id(), "Security Engineering", false);
        assertThat(accounts.canAccessProject(user.id(), "012345abcdef")).isFalse();
        assertThat(accounts.organizations(user.id())).isEmpty();
        assertThat(accounts.projectOwner(admin.id(), "012345abcdef").ownerId()).isEqualTo(team.id());
        accounts.updateOrganization(admin.id(), team.id(), "Security Engineering", true);
        assertThat(accounts.canAccessProject(user.id(), "012345abcdef")).isTrue();
        assertThat(accounts.auditEvents(admin.id(), 100)).extracting(event -> event.action())
                .contains("ACCOUNT_ACTIVE", "MEMBER_ADDED", "PROJECT_ASSIGNED", "ORGANIZATION_UPDATED");
        assertThatThrownBy(() -> accounts.auditEvents(user.id(), 100)).isInstanceOf(IdentityException.class);
        assertThatThrownBy(() -> accounts.members(user.id(), team.id())).isInstanceOf(IdentityException.class);
        assertThat(accounts.members(admin.id(), team.id())).extracting(account -> account.id()).containsExactly(user.id());
    }

}
