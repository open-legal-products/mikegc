"use client";

import { useRouter } from "next/navigation";
import { IntakeSettings } from "@/app/components/intake/IntakeSettings";
import {
  organizationSettingsHref,
  useOrganizationSettings,
} from "@/app/components/organizations/OrganizationSettingsShell";
import { OrganizationSkeuoIcon } from "@/app/components/shared/AppSidebarSkeuoIcons";
import { EmptyState } from "@/app/components/ui/empty-state";
import { isOrgAdmin } from "@/app/lib/permissions";
import { PillButtonUI } from "@mike/ui";

/**
 * How MikeGC records requests from email and Slack: its owners' and admins'
 * alone. The section is not offered to a member, and one who follows a link
 * to it is told why.
 */
export default function OrganizationIntakeSettingsPage() {
  const router = useRouter();
  const { orgId, org } = useOrganizationSettings();
  if (org && !isOrgAdmin(org.role))
    return (
      <EmptyState
        icon={<OrganizationSkeuoIcon />}
        title="Intake"
        description="Only this organization's owners and admins can change automated intake."
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
  return <IntakeSettings key={orgId} orgId={orgId} />;
}
