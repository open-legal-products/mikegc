"use client";

import { useRouter } from "next/navigation";
import { OrganizationProfileSettings } from "@/app/components/organizations/OrganizationProfileSettings";
import {
  organizationSettingsHref,
  useOrganizationSettings,
} from "@/app/components/organizations/OrganizationSettingsShell";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { EmptyState } from "@/app/components/ui/empty-state";
import { isOrgAdmin } from "@/app/lib/permissions";
import { PillButtonUI } from "@mike/ui";

/**
 * What the assistant and the intake agent are told about the organization:
 * its owners' and admins' to write. The section is not offered to a member,
 * and one who follows a link to it is told why.
 */
export default function OrganizationProfileSettingsPage() {
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();
  if (org && !isOrgAdmin(org.role))
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title="Profile"
        description="Only this organization's owners and admins can change its profile."
        action={
          <PillButtonUI
            tone="white"
            size="sm"
            onClick={() => router.push(organizationSettingsHref(orgId))}
          >
            Back to General
          </PillButtonUI>
        }
      />
    );
  // Mounted before the role is known, so it loads alongside the
  // organization; the server refuses a member's change either way.
  return <OrganizationProfileSettings key={orgId} orgId={orgId} />;
}
