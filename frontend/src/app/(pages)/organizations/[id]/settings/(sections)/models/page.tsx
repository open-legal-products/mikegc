"use client";

import { useRouter } from "next/navigation";
import { IntakeModelSettings } from "@/app/components/intake/IntakeModelSettings";
import {
  organizationSettingsHref,
  useOrganizationSettings,
} from "@/app/components/organizations/OrganizationSettingsShell";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { EmptyState } from "@/app/components/ui/empty-state";
import { isOrgAdmin } from "@/app/lib/permissions";
import { PillButtonUI } from "@mike/ui";

/**
 * The models the organization's features run with, its owners' and admins'
 * alone: for now, intake's triage and AI preprocessing. A member who follows
 * a link here is told why there is nothing to change.
 */
export default function OrganizationModelPreferencesPage() {
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();
  if (org && !isOrgAdmin(org.role))
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title="Model Preferences"
        description="Only this organization's owners and admins can choose its models."
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
  // organization; the server refuses a member's read either way.
  return <IntakeModelSettings key={orgId} orgId={orgId} />;
}
