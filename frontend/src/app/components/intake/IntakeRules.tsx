"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  CircleSlash,
  GripVertical,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  IntakeAutomationSettings,
  IntakeMember,
  IntakePreprocessRule,
} from "@mike/contracts";
import {
  PERSONAL_WORKSPACE,
  useWorkspace,
} from "@/app/contexts/WorkspaceContext";
import { PageHeader } from "@/app/components/shared/PageHeader";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
  PlaybookSkeuoIcon,
  WorkflowSkeuoIcon,
} from "@/app/components/shared/AppSidebarSkeuoIcons";
import { RowActions } from "@/app/components/shared/RowActions";
import { SelectionActionsMenu } from "@/app/components/shared/SelectionActionsMenu";
import {
  SkeletonLine,
  TABLE_CHECKBOX_CLASS,
  TableBody,
  TableCell,
  TableEmptyState,
  TableFilters,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  TableScrollArea,
  type TableFilterOption,
} from "@/app/components/shared/TablePrimitive";
import { TableToolbar } from "@/app/components/shared/TableToolbar";
import type { Workflow } from "@/app/components/shared/types";
import { EmptyState } from "@/app/components/ui/empty-state";
import { LIQUID_GLASS_HOVER_CLASS } from "@/app/components/ui/liquid-surface";
import { UserAvatar } from "@/app/components/ui/user-avatar";
import {
  getIntakeAutomation,
  getIntakeMembers,
  listPlaybooks,
  listWorkflows,
  type Playbook,
} from "@/app/lib/mikeApi";
import { describeError } from "@/app/lib/userFacingError";
import { setRowDragPreview } from "@/app/lib/rowDragPreview";
import { cn } from "@/app/lib/utils";
import { LIQUID_GLASS_FLOAT_CLASS } from "@mike/ui";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownRadioGroup,
  DropdownRadioItem,
  DropdownSeparator,
  DropdownTrigger,
} from "@mike/ui";
import { PillButtonUI } from "@mike/ui";
import { PLAIN_FIELD_CLASS } from "./IntakeDetailsPanel";
import {
  MAX_INTAKE_RULE_CONDITION,
  MAX_INTAKE_RULES,
  intakeAutomationDraft,
  isCompleteIntakeRule,
  moveIntakeRule,
  newIntakeRule,
  type IntakeAutomationDraft,
  type IntakeRuleDraft,
} from "./intakeAutomation";
import { intakeMemberName } from "./intakeLabels";
import { intakeSettingsHref } from "./intakeQuery";
import {
  IntakeSaveStatus,
  useIntakeAutomationAutosave,
} from "./useIntakeAutomationAutosave";

/** A table field that reads as its value until hovered or focused. */
const FIELD_CLASS = cn(PLAIN_FIELD_CLASS, "min-h-8 text-xs text-gray-800");
const MENU_FIELD_CLASS = cn(
  FIELD_CLASS,
  "flex items-center justify-between gap-2 py-1 text-left [overflow-wrap:anywhere] disabled:hover:bg-transparent",
);
/** A heading in a field's menu, in sentence case like the choices under it. */
const MENU_HEADING_CLASS =
  "text-xs font-medium normal-case tracking-normal text-gray-500";
/** AI preprocessing's Yes or No, as a pill: green when on, grey when off. */
const PREPROCESS_PILL_CLASS =
  "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium";
/** Cells hold fields, so their focus rings must not be clipped. */
const FIELD_CELL_CLASS = "overflow-visible whitespace-normal";

/** The columns' widths, shared by the header, rows and loading rows. */
const COLUMNS = {
  number: "flex w-28 shrink-0 items-center pl-3",
  condition: "min-w-72 flex-1 shrink pr-4",
  assignee: "w-56 shrink-0 gap-1 pr-4",
  preprocess: "w-40 shrink-0 gap-1 pr-4",
  preprocessWith: "w-64 shrink-0 gap-1 pr-4",
  actions: "flex w-8 shrink-0 justify-end",
};
/** Priority's label and numbers, right-aligned to one edge. */
const PRIORITY_CLASS = "w-12 shrink-0 text-right tabular-nums";
const TABLE_MIN_WIDTH = "min-w-[64rem]";
/** A rule being dragged, told apart from files and text dropped on the page. */
const RULE_DRAG_TYPE = "application/x-mike-intake-rule";

type DropTarget = { key: string; position: "before" | "after" };

/** The workflows and playbooks a rule's preprocessing can follow. */
type Choices = {
  workflows: { id: string; name: string }[];
  playbooks: { id: string; name: string }[];
  /** They couldn't be listed; a rule keeps what it has. */
  failed: boolean;
  /** Still being listed, apart from the rules, which show without them. */
  loading: boolean;
};
const LISTING_CHOICES: Choices = {
  workflows: [],
  playbooks: [],
  failed: false,
  loading: true,
};

type Loaded = {
  settings: IntakeAutomationSettings;
  members: IntakeMember[];
};

type Filters = {
  assignee: string | null;
  preprocess: "yes" | "no" | null;
  /** A workflow or playbook as "kind:id", or "none". */
  preprocessWith: string | null;
};
const NO_FILTERS: Filters = {
  assignee: null,
  preprocess: null,
  preprocessWith: null,
};
/** The toolbar's tabs, which split the rules by AI preprocessing. */
type RulesTab = "all" | "yes" | "no";
const RULES_TABS: { id: RulesTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "yes", label: "Preprocessed" },
  { id: "no", label: "Not preprocessed" },
];

/** Where the header's first crumb leads: the workspace's settings. */
function settingsRoot(orgId: string) {
  return orgId === PERSONAL_WORKSPACE
    ? { label: "Settings", href: "/settings" }
    : {
        label: "Organization",
        href: `/organizations/${encodeURIComponent(orgId)}/settings`,
      };
}

/**
 * The rules as a table page of their own, under the Intake section of the
 * workspace's settings: an organization's, or for Personal the person's. Its
 * header leads back to both.
 */
export function IntakeRulesPage({
  orgId,
  allowed = true,
}: {
  orgId: string;
  /** False for a member, who is told so rather than shown the rules. */
  allowed?: boolean;
}) {
  const { accountId } = useWorkspace();
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Breadcrumbs are not a heading; this names the page for assistive technology. */}
      <h1 className="sr-only">Intake rules</h1>
      {allowed && accountId ? (
        <IntakeRules key={`${accountId}:${orgId}`} orgId={orgId} />
      ) : (
        <>
          <RulesHeader orgId={orgId} />
          {allowed ? (
            <EmptyState
              title="Rules"
              description="Sign in to change intake rules."
            />
          ) : (
            <RulesForbidden />
          )}
        </>
      )}
    </div>
  );
}

/** The page's header: Organization (or Settings) › Intake › Rules, and its actions. */
function RulesHeader({
  orgId,
  actionGroups = [],
}: {
  orgId: string;
  actionGroups?: ComponentProps<typeof PageHeader>["actionGroups"];
}) {
  const router = useRouter();
  const root = settingsRoot(orgId);
  return (
    <PageHeader
      shrink
      breadcrumbs={[
        { label: root.label, onClick: () => router.push(root.href) },
        {
          label: "Intake",
          onClick: () => router.push(intakeSettingsHref(orgId)),
        },
        { label: "Rules", title: "Rules" },
      ]}
      actionGroups={actionGroups}
    />
  );
}

/** What a member who opens the rules by link is told. */
function RulesForbidden() {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState
        title="Rules"
        description="Only owners and admins can change intake rules."
      />
    </div>
  );
}

/**
 * The rules that decide, for requests MikeGC records from email and Slack,
 * who each goes to and whether MikeGC preprocesses it: answers the request
 * and marks up its Word documents, following a workflow or playbook if the
 * rule names one. Rules are tried from the top. Laid out as other tables:
 * search and New rule in the header, tabs by AI preprocessing in the toolbar,
 * filters on the columns, and checkboxes whose selection the toolbar's
 * Actions act on. Every change saves by
 * itself; a rule saves once it has a condition and a member.
 */
export function IntakeRules({ orgId }: { orgId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState<IntakeAutomationDraft | null>(null);
  const [failure, setFailure] = useState<
    { forbidden: true } | { forbidden: false; message: string } | null
  >(null);
  const [reload, setReload] = useState(0);
  // The rule just added, whose condition takes focus once it renders.
  const [added, setAdded] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The rules a Delete is waiting to be confirmed for.
  const [deleting, setDeleting] = useState<string[] | null>(null);
  // The rule being dragged, and where it would land.
  const [dragged, setDragged] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [choices, setChoices] = useState<Choices>(LISTING_CHOICES);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      getIntakeAutomation(orgId),
      getIntakeMembers(orgId),
    ]).then(([settings, members]) => {
      if (!active) return;
      if (settings.status === "rejected" || members.status === "rejected") {
        const failed =
          settings.status === "rejected"
            ? settings.reason
            : (members as PromiseRejectedResult).reason;
        const described = describeError(failed, { action: "load the rules" });
        setFailure(
          described.kind === "forbidden" && settings.status === "rejected"
            ? { forbidden: true }
            : { forbidden: false, message: described.message },
        );
        return;
      }
      setLoaded({ settings: settings.value, members: members.value });
      setDraft(intakeAutomationDraft(settings.value));
      setFailure(null);
    });
    return () => {
      active = false;
    };
  }, [orgId, reload]);
  // What preprocessing can follow is listed apart, so a slow list never
  // holds up the rules; a rule names its own until the lists arrive.
  useEffect(() => {
    let active = true;
    Promise.allSettled([
      listWorkflows("assistant", orgId),
      listPlaybooks(orgId),
    ]).then(([workflows, playbooks]) => {
      if (!active) return;
      setChoices({
        // Catalog workflows aren't the organization's to run.
        workflows:
          workflows.status === "fulfilled"
            ? workflows.value
                .filter(
                  (w: Workflow) =>
                    !w.is_system && w.metadata.type === "assistant",
                )
                .map((w: Workflow) => ({ id: w.id, name: w.metadata.title }))
            : [],
        playbooks:
          playbooks.status === "fulfilled"
            ? playbooks.value.map((p: Playbook) => ({ id: p.id, name: p.name }))
            : [],
        failed:
          workflows.status === "rejected" || playbooks.status === "rejected",
        loading: false,
      });
    });
    return () => {
      active = false;
    };
  }, [orgId]);

  const saving = useIntakeAutomationAutosave({
    orgId,
    settings: loaded?.settings ?? null,
    draft,
    onSettings: (settings) =>
      setLoaded((current) => (current ? { ...current, settings } : current)),
    onDraft: (next) =>
      setDraft((current) => (current ? next(current) : current)),
  });

  const rules = draft?.rules ?? [];
  const setRules = (next: IntakeRuleDraft[]) =>
    setDraft((current) => (current ? { ...current, rules: next } : current));
  const update = (key: string, patch: Partial<IntakeRuleDraft>) =>
    setRules(
      rules.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)),
    );
  // Past the next rule shown, so a filtered table never moves a rule past
  // one it hides; the rules in between keep their order.
  const move = (key: string, past: string, by: -1 | 1) =>
    setRules(moveIntakeRule(rules, key, past, by < 0 ? "before" : "after"));
  const remove = (keys: string[]) => {
    setRules(rules.filter((rule) => !keys.includes(rule.key)));
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keys) next.delete(key);
      return next;
    });
  };
  const isRuleDrag = (event: DragEvent<HTMLElement>) =>
    !!dragged && Array.from(event.dataTransfer.types).includes(RULE_DRAG_TYPE);
  // Over a row's top half the rule lands before it; over its bottom half, after.
  const dropTargetAt = (
    event: DragEvent<HTMLElement>,
    key: string,
  ): DropTarget => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      key,
      position:
        event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    };
  };
  const endDrag = () => {
    setDragged(null);
    setDropTarget(null);
  };
  const add = () => {
    const rule = newIntakeRule();
    setAdded(rule.key);
    // A new rule shows whatever is filtering the table.
    setSearch("");
    setFilters(NO_FILTERS);
    setRules([...rules, rule]);
  };
  const changeFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setSelected(new Set());
  };

  const query = search.trim().toLowerCase();
  // Each rule keeps its number, its place in the order, while filtered.
  const numbered = rules.map((rule, index) => ({ rule, index }));
  const shown = numbered.filter(({ rule }) => {
    if (query && !rule.condition.toLowerCase().includes(query)) return false;
    if (filters.assignee && rule.assigneeId !== filters.assignee) return false;
    if (
      filters.preprocess &&
      rule.preprocess !== (filters.preprocess === "yes")
    )
      return false;
    if (filters.preprocessWith) {
      const key = rule.preprocess ? refKey(rule.preprocessWith) || "none" : "";
      if (key !== filters.preprocessWith) return false;
    }
    return true;
  });
  const checked = shown.filter(({ rule }) => selected.has(rule.key));

  const memberOptions: TableFilterOption<string>[] = (loaded?.members ?? [])
    .filter((member) =>
      rules.some((rule) => rule.assigneeId === member.user_id),
    )
    .map((member) => ({
      value: member.user_id,
      label: intakeMemberName(member),
    }));
  const preprocessWithOptions: TableFilterOption<string>[] = [];
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!rule.preprocess) continue;
    const key = refKey(rule.preprocessWith) || "none";
    if (seen.has(key)) continue;
    seen.add(key);
    preprocessWithOptions.push({
      value: key,
      label: preprocessLabel(rule.preprocessWith, choices) ?? "None",
    });
  }

  const ready = loaded && draft;
  const showFilters = !!ready && rules.length > 0;
  const header = (
    <RulesHeader
      orgId={orgId}
      actionGroups={
        failure
          ? []
          : [
              // Shown, as on a playbook, only while there is something to say.
              [
                ready &&
                  (saving.saveError || saving.autosave.status !== "idle") && {
                    type: "custom",
                    render: (
                      <span
                        aria-live="polite"
                        className="inline-flex h-7 items-center px-1 text-xs"
                      >
                        <IntakeSaveStatus state={saving} />
                      </span>
                    ),
                  },
              ],
              [
                {
                  type: "search",
                  value: search,
                  onChange: (value) => {
                    setSearch(value);
                    setSelected(new Set());
                  },
                  placeholder: "Search rules…",
                },
                {
                  type: "new",
                  title: "New rule",
                  disabled: !ready || rules.length >= MAX_INTAKE_RULES,
                  onClick: add,
                },
              ],
            ]
      }
    />
  );

  if (failure)
    return (
      <>
        {header}
        {failure.forbidden ? (
          <RulesForbidden />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              tone="error"
              title="Unable to load the rules"
              description={<span role="alert">{failure.message}</span>}
              action={
                <PillButtonUI
                  tone="black"
                  size="sm"
                  onClick={() => {
                    setFailure(null);
                    setReload((n) => n + 1);
                  }}
                >
                  Try again
                </PillButtonUI>
              }
            />
          </div>
        )}
      </>
    );

  return (
    <>
      {header}
      <TableToolbar
        items={RULES_TABS}
        active={filters.preprocess ?? "all"}
        onChange={(tab) =>
          changeFilter("preprocess", tab === "all" ? null : tab)
        }
        actions={
          checked.length > 0 ? (
            <SelectionActionsMenu
              renderItems={(close) => (
                <>
                  <DropdownItem
                    onSelect={() => {
                      const keys = checked.map(({ rule }) => rule.key);
                      setRules(
                        rules.map((rule) =>
                          keys.includes(rule.key)
                            ? { ...rule, preprocess: true }
                            : rule,
                        ),
                      );
                      close();
                    }}
                  >
                    <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                    Turn on AI preprocessing
                  </DropdownItem>
                  <DropdownItem
                    onSelect={() => {
                      const keys = checked.map(({ rule }) => rule.key);
                      setRules(
                        rules.map((rule) =>
                          keys.includes(rule.key)
                            ? { ...rule, preprocess: false }
                            : rule,
                        ),
                      );
                      close();
                    }}
                  >
                    <CircleSlash aria-hidden="true" className="h-3.5 w-3.5" />
                    Turn off AI preprocessing
                  </DropdownItem>
                  <DropdownSeparator />
                  <DropdownItem
                    onSelect={() => {
                      setSelected(new Set());
                      close();
                    }}
                  >
                    <X aria-hidden="true" className="h-3.5 w-3.5" />
                    Deselect
                  </DropdownItem>
                  <DropdownItem
                    variant="destructive"
                    onSelect={() => {
                      setDeleting(checked.map(({ rule }) => rule.key));
                      close();
                    }}
                  >
                    <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
                    Delete
                  </DropdownItem>
                </>
              )}
            />
          ) : undefined
        }
      />
      <TableScrollArea
        header={
          <TableHeaderRow className={TABLE_MIN_WIDTH}>
            <TableHeaderCell className={COLUMNS.number}>
              <input
                type="checkbox"
                aria-label="Select all rules"
                className={TABLE_CHECKBOX_CLASS}
                disabled={!ready || shown.length === 0}
                checked={shown.length > 0 && checked.length === shown.length}
                ref={(node) => {
                  if (node)
                    node.indeterminate =
                      checked.length > 0 && checked.length < shown.length;
                }}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? new Set(shown.map(({ rule }) => rule.key))
                      : new Set(),
                  )
                }
              />
              <span className={PRIORITY_CLASS}>Priority</span>
            </TableHeaderCell>
            <TableHeaderCell className={COLUMNS.condition}>
              Condition
            </TableHeaderCell>
            <TableHeaderCell className={COLUMNS.assignee}>
              <span>Assign to</span>
              {showFilters && (
                <TableFilters
                  label="Filter by member"
                  value={filters.assignee}
                  allLabel="All Members"
                  widthClassName="w-56"
                  options={memberOptions}
                  onChange={(value) => changeFilter("assignee", value)}
                />
              )}
            </TableHeaderCell>
            <TableHeaderCell className={COLUMNS.preprocess}>
              AI preprocessing
            </TableHeaderCell>
            <TableHeaderCell className={COLUMNS.preprocessWith}>
              <span>Preprocessing rule</span>
              {showFilters && preprocessWithOptions.length > 0 && (
                <TableFilters
                  label="Filter by preprocessing rule"
                  value={filters.preprocessWith}
                  allLabel="All Preprocessing Rules"
                  widthClassName="w-64"
                  options={preprocessWithOptions}
                  onChange={(value) => changeFilter("preprocessWith", value)}
                />
              )}
            </TableHeaderCell>
            <TableHeaderCell className={COLUMNS.actions}>
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableHeaderRow>
        }
      >
        {!ready ? (
          <RulesLoadingRows />
        ) : rules.length === 0 ? (
          <TableEmptyState>
            <EmptyState
              title="No rules yet"
              description="Requests MikeGC records are left unassigned. Add a rule to assign them, and to have MikeGC preprocess them."
              action={
                <PillButtonUI tone="black" size="sm" onClick={add}>
                  New rule
                </PillButtonUI>
              }
            />
          </TableEmptyState>
        ) : shown.length === 0 ? (
          <TableEmptyState>
            <EmptyState
              title="No matching rules"
              description="Try another search, or adjust the table filters."
              action={
                <PillButtonUI
                  tone="white"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setFilters(NO_FILTERS);
                  }}
                >
                  Clear filters
                </PillButtonUI>
              }
            />
          </TableEmptyState>
        ) : (
          <TableBody className={TABLE_MIN_WIDTH}>
            {shown.map(({ rule, index }, at) => (
              <RuleRow
                key={rule.key}
                rule={rule}
                number={index + 1}
                members={loaded.members}
                choices={choices}
                selected={selected.has(rule.key)}
                onSelect={(on) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (on) next.add(rule.key);
                    else next.delete(rule.key);
                    return next;
                  })
                }
                autoFocus={rule.key === added}
                onFocused={() => setAdded(null)}
                onChange={(patch) => update(rule.key, patch)}
                onMoveUp={
                  at > 0
                    ? () => move(rule.key, shown[at - 1].rule.key, -1)
                    : undefined
                }
                onMoveDown={
                  at < shown.length - 1
                    ? () => move(rule.key, shown[at + 1].rule.key, 1)
                    : undefined
                }
                onDelete={() => setDeleting([rule.key])}
                dragging={dragged === rule.key}
                dropPosition={
                  dropTarget?.key === rule.key && dragged !== rule.key
                    ? dropTarget.position
                    : null
                }
                onDragStart={(event, row) => {
                  event.dataTransfer.setData(RULE_DRAG_TYPE, rule.key);
                  event.dataTransfer.effectAllowed = "move";
                  setRowDragPreview({
                    dataTransfer: event.dataTransfer,
                    row,
                    clientX: event.clientX,
                    clientY: event.clientY,
                  });
                  setDragged(rule.key);
                }}
                onDragOver={(event) => {
                  if (!isRuleDrag(event)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  const target = dropTargetAt(event, rule.key);
                  setDropTarget((current) =>
                    current?.key === target.key &&
                    current.position === target.position
                      ? current
                      : target,
                  );
                }}
                onDrop={(event) => {
                  if (!isRuleDrag(event)) return;
                  event.preventDefault();
                  const target = dropTargetAt(event, rule.key);
                  if (event.dataTransfer.getData(RULE_DRAG_TYPE) === dragged)
                    setRules(
                      moveIntakeRule(
                        rules,
                        dragged,
                        target.key,
                        target.position,
                      ),
                    );
                  endDrag();
                }}
                onDragEnd={endDrag}
              />
            ))}
          </TableBody>
        )}
      </TableScrollArea>
      <ConfirmPopup
        open={deleting !== null}
        title={
          deleting?.length === 1
            ? "Delete this rule?"
            : `Delete ${deleting?.length ?? 0} rules?`
        }
        message="Requests MikeGC records from now on won't be assigned or preprocessed by them."
        confirmLabel="Delete"
        cancelLabel="Keep"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) remove(deleting);
          setDeleting(null);
        }}
      />
    </>
  );
}

function RuleRow({
  rule,
  number,
  members,
  choices,
  selected,
  onSelect,
  autoFocus,
  onFocused,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  dragging,
  dropPosition,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  rule: IntakeRuleDraft;
  number: number;
  members: IntakeMember[];
  choices: Choices;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  autoFocus: boolean;
  onFocused: () => void;
  onChange: (patch: Partial<IntakeRuleDraft>) => void;
  /** Absent for the first rule, which cannot move up. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  /** This rule is the one being dragged. */
  dragging: boolean;
  /** Where a dragged rule would land against this one, if over it. */
  dropPosition: "before" | "after" | null;
  onDragStart: (event: DragEvent<HTMLElement>, row: HTMLElement) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
}) {
  // An overflowing condition opens over the rows below, so its row rises.
  const [expanded, setExpanded] = useState(false);
  const conditionRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    conditionRef.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);
  const unfinished =
    (!!rule.condition.trim() || !!rule.assigneeId) &&
    !isCompleteIntakeRule(rule);
  const hintId = `rule-${rule.key}-hint`;
  // The same actions in the row's menu and its right-click menu.
  const actions = (done: () => void) => (
    <>
      <DropdownItem
        disabled={!onMoveUp}
        onSelect={() => {
          onMoveUp?.();
          done();
        }}
      >
        <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
        Move up
      </DropdownItem>
      <DropdownItem
        disabled={!onMoveDown}
        onSelect={() => {
          onMoveDown?.();
          done();
        }}
      >
        <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
        Move down
      </DropdownItem>
      <DropdownSeparator />
      <DropdownItem
        variant="destructive"
        onSelect={() => {
          onDelete();
          done();
        }}
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
        Delete
      </DropdownItem>
    </>
  );
  return (
    <TableRow
      data-rule-row=""
      interactive={false}
      selected={selected}
      aria-selected={selected}
      className={cn(
        "group relative h-auto min-h-10 items-start py-1",
        TABLE_MIN_WIDTH,
        LIQUID_GLASS_HOVER_CLASS,
        dragging && "opacity-50",
        expanded && "z-[60]",
      )}
      rightClickDropdown={actions}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {dropPosition && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-x-2 z-10 h-0.5 rounded-full bg-blue-500",
            dropPosition === "before" ? "top-0" : "bottom-0",
          )}
        />
      )}
      <TableCell className={cn(COLUMNS.number, "min-h-8 text-gray-500")}>
        <input
          type="checkbox"
          aria-label={`Select rule ${number}`}
          className={TABLE_CHECKBOX_CLASS}
          checked={selected}
          onChange={(event) => onSelect(event.target.checked)}
        />
        <span className={PRIORITY_CLASS}>{number}</span>
        {/* Dragging reorders by pointer; Move up and Move down, in the row's menu, by keyboard. */}
        <span
          aria-hidden="true"
          title="Drag to reorder"
          draggable
          onDragStart={(event) =>
            onDragStart(
              event,
              event.currentTarget.closest<HTMLElement>("[data-rule-row]")!,
            )
          }
          onDragEnd={onDragEnd}
          className="ml-1.5 flex h-6 w-4 cursor-grab items-center justify-center rounded text-gray-400 opacity-0 transition-opacity hover:text-gray-700 group-hover:opacity-100 active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      </TableCell>
      <TableCell className={cn(COLUMNS.condition, FIELD_CELL_CLASS)}>
        <ConditionField
          inputRef={conditionRef}
          number={number}
          value={rule.condition}
          describedBy={unfinished ? hintId : undefined}
          expanded={expanded}
          onExpandedChange={setExpanded}
          onChange={(condition) => onChange({ condition })}
        />
        {unfinished && (
          <p id={hintId} className="mt-0.5 text-xs text-gray-500">
            {rule.saved
              ? "Until it has a condition, this rule keeps its saved one."
              : rule.assigneeId
                ? "Add a condition to save this rule."
                : "Choose who to assign to save this rule."}
          </p>
        )}
      </TableCell>
      <TableCell className={cn(COLUMNS.assignee, FIELD_CELL_CLASS)}>
        <AssigneeField
          number={number}
          members={members}
          assigneeId={rule.assigneeId}
          describedBy={unfinished ? hintId : undefined}
          onChange={(assigneeId) => onChange({ assigneeId })}
        />
      </TableCell>
      <TableCell className={cn(COLUMNS.preprocess, FIELD_CELL_CLASS)}>
        <PreprocessField
          number={number}
          value={rule.preprocess}
          onChange={(preprocess) => onChange({ preprocess })}
        />
      </TableCell>
      <TableCell className={cn(COLUMNS.preprocessWith, FIELD_CELL_CLASS)}>
        <PreprocessWithField
          number={number}
          enabled={rule.preprocess}
          value={rule.preprocessWith}
          choices={choices}
          onChange={(preprocessWith) => onChange({ preprocessWith })}
        />
      </TableCell>
      <TableCell
        className={cn(
          COLUMNS.actions,
          "flex min-h-8 items-center overflow-visible",
        )}
      >
        <RowActions
          ariaLabel={`Actions for rule ${number}`}
          renderItems={actions}
        />
      </TableCell>
    </TableRow>
  );
}

/**
 * A rule's condition: one line in the table, and, when its text doesn't fit,
 * clicking or tabbing into it opens the whole condition over the rows below,
 * as a tabular review's cell does. Enter, Escape or leaving it closes it.
 */
function ConditionField({
  inputRef,
  number,
  value,
  describedBy,
  expanded,
  onExpandedChange,
  onChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  number: number;
  value: string;
  describedBy?: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onChange: (value: string) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  // Focus returning to the line after closing must not open it again.
  const returning = useRef(false);
  const label = `Rule ${number} condition`;

  // Opened with the caret at the end, as tall as its text.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!expanded || !area) return;
    if (document.activeElement !== area) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [expanded, value]);

  const openIfOverflowing = () => {
    if (returning.current) {
      returning.current = false;
      return;
    }
    const input = inputRef.current;
    if (input && input.scrollWidth > input.clientWidth) onExpandedChange(true);
  };
  const close = (refocus: boolean) => {
    onExpandedChange(false);
    if (!refocus) return;
    returning.current = true;
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        aria-label={label}
        aria-describedby={describedBy}
        autoComplete="off"
        maxLength={MAX_INTAKE_RULE_CONDITION}
        placeholder="Such as: the request is about an NDA"
        value={value}
        // Hidden behind the open condition, which takes its name and focus.
        tabIndex={expanded ? -1 : undefined}
        aria-hidden={expanded || undefined}
        className={FIELD_CLASS}
        onFocus={openIfOverflowing}
        onClick={openIfOverflowing}
        onChange={(event) => onChange(event.target.value)}
      />
      {expanded && (
        <div
          className={cn(
            "absolute -inset-x-1 -top-1 z-50 rounded-xl p-1",
            LIQUID_GLASS_FLOAT_CLASS,
          )}
        >
          <textarea
            ref={areaRef}
            aria-label={label}
            aria-describedby={describedBy}
            rows={1}
            maxLength={MAX_INTAKE_RULE_CONDITION}
            value={value}
            className="block w-full resize-none rounded-md bg-transparent px-2 py-1.5 text-xs leading-relaxed text-gray-800 outline-none [overflow-wrap:anywhere]"
            // A condition is one paragraph: a line break would not save.
            onChange={(event) =>
              onChange(event.target.value.replace(/[\r\n]+/g, " "))
            }
            onKeyDown={(event) => {
              if (
                event.key === "Escape" ||
                (event.key === "Enter" && !event.shiftKey)
              ) {
                event.preventDefault();
                close(true);
              }
            }}
            onBlur={() => close(false)}
          />
        </div>
      )}
    </div>
  );
}

/** Chooses the member a rule assigns to, each shown with their avatar. */
function AssigneeField({
  number,
  members,
  assigneeId,
  describedBy,
  onChange,
}: {
  number: number;
  members: IntakeMember[];
  assigneeId: string | null;
  describedBy?: string;
  onChange: (assigneeId: string) => void;
}) {
  const current = members.find((m) => m.user_id === assigneeId);
  const name = current ? intakeMemberName(current) : null;
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={`Rule ${number} assigns to ${name ?? "no one yet"}`}
          aria-describedby={describedBy}
          className={MENU_FIELD_CLASS}
        >
          {current ? (
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden="true" className="flex">
                <UserAvatar
                  size="sm"
                  name={current.display_name}
                  email={current.email}
                  photo={current.profile_photo}
                />
              </span>
              <span className="min-w-0">{name}</span>
            </span>
          ) : (
            <span className="text-gray-400">Choose a member</span>
          )}
          <ChevronDown
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-gray-400"
          />
        </button>
      </DropdownTrigger>
      <DropdownContent
        align="start"
        className="max-h-72 w-[var(--radix-dropdown-menu-trigger-width)] min-w-56 overflow-y-auto"
      >
        <DropdownRadioGroup
          value={assigneeId ?? ""}
          onValueChange={(value) => {
            if (value && value !== assigneeId) onChange(value);
          }}
        >
          {members.map((member) => (
            <DropdownRadioItem key={member.user_id} value={member.user_id}>
              <span aria-hidden="true" className="flex">
                <UserAvatar
                  size="sm"
                  name={member.display_name}
                  email={member.email}
                  photo={member.profile_photo}
                />
              </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {intakeMemberName(member)}
                {member.display_name && member.email && (
                  <span className="block text-gray-500">{member.email}</span>
                )}
              </span>
            </DropdownRadioItem>
          ))}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}

/** Yes or No: whether MikeGC preprocesses what the rule assigns. */
function PreprocessField({
  number,
  value,
  onChange,
}: {
  number: number;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={`Rule ${number} AI preprocessing: ${value ? "Yes" : "No"}`}
          className={MENU_FIELD_CLASS}
        >
          <span
            className={cn(
              PREPROCESS_PILL_CLASS,
              value
                ? "bg-emerald-50 text-emerald-700"
                : "bg-gray-100 text-gray-500",
            )}
          >
            {value ? "Yes" : "No"}
          </span>
          <ChevronDown
            aria-hidden="true"
            className="h-3.5 w-3.5 shrink-0 text-gray-400"
          />
        </button>
      </DropdownTrigger>
      <DropdownContent
        align="start"
        className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-32"
      >
        <DropdownRadioGroup
          value={value ? "yes" : "no"}
          onValueChange={(next) => {
            if ((next === "yes") !== value) onChange(next === "yes");
          }}
        >
          <DropdownRadioItem value="yes">Yes</DropdownRadioItem>
          <DropdownRadioItem value="no">No</DropdownRadioItem>
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}

const refKey = (ref: { kind: string; id: string } | null) =>
  ref ? `${ref.kind}:${ref.id}` : "";

/** What a rule's workflow or playbook is called here. */
function preprocessLabel(value: IntakePreprocessRule | null, choices: Choices) {
  if (!value) return null;
  const listed = (
    value.kind === "workflow" ? choices.workflows : choices.playbooks
  ).find((c) => c.id === value.id);
  return (
    listed?.name ??
    value.name ??
    (value.kind === "workflow"
      ? "A workflow you can't open"
      : "A playbook you can't open")
  );
}

/**
 * The workflow or playbook preprocessing follows, or none, when MikeGC
 * answers in general terms. Only a rule that preprocesses has one to choose.
 */
function PreprocessWithField({
  number,
  enabled,
  value,
  choices,
  onChange,
}: {
  number: number;
  enabled: boolean;
  value: IntakePreprocessRule | null;
  choices: Choices;
  onChange: (value: IntakePreprocessRule | null) => void;
}) {
  const label = preprocessLabel(value, choices);
  const Icon =
    value?.kind === "playbook" ? PlaybookSkeuoIcon : WorkflowSkeuoIcon;
  const options = [
    ...choices.workflows.map((c) => ({ kind: "workflow" as const, ...c })),
    ...choices.playbooks.map((c) => ({ kind: "playbook" as const, ...c })),
  ];
  const find = (key: string) =>
    options.find((o) => refKey(o) === key) ??
    (value && refKey(value) === key ? { ...value, name: label } : null);
  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          disabled={!enabled}
          aria-label={`Rule ${number} preprocessing rule: ${
            !enabled ? "not used" : (label ?? "None")
          }`}
          className={MENU_FIELD_CLASS}
        >
          {!enabled ? (
            <span className="text-gray-400">—</span>
          ) : label ? (
            <span className="flex min-w-0 items-center gap-2">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span
                className={cn(
                  "min-w-0",
                  value?.name === null && "text-gray-500",
                )}
              >
                {label}
              </span>
            </span>
          ) : (
            <span className="text-gray-500">None</span>
          )}
          {enabled && (
            <ChevronDown
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 text-gray-400"
            />
          )}
        </button>
      </DropdownTrigger>
      <DropdownContent
        align="start"
        className="max-h-80 w-[var(--radix-dropdown-menu-trigger-width)] min-w-64 overflow-y-auto"
      >
        <DropdownRadioGroup
          value={refKey(value)}
          onValueChange={(key) => {
            if (key === refKey(value)) return;
            const chosen = find(key);
            onChange(
              chosen
                ? { kind: chosen.kind, id: chosen.id, name: chosen.name }
                : null,
            );
          }}
        >
          <DropdownRadioItem value="">
            <span className="min-w-0">
              None
              <span className="block text-gray-500">
                Answer in general terms
              </span>
            </span>
          </DropdownRadioItem>
          <DropdownSeparator />
          <DropdownLabel className={MENU_HEADING_CLASS}>
            Workflows
          </DropdownLabel>
          {choices.workflows.length === 0 && (
            <DropdownItem disabled>
              {choices.loading ? "Loading…" : "No assistant workflows"}
            </DropdownItem>
          )}
          {choices.workflows.map((c) => (
            <DropdownRadioItem
              key={c.id}
              value={refKey({ kind: "workflow", id: c.id })}
            >
              <WorkflowSkeuoIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span>
            </DropdownRadioItem>
          ))}
          <DropdownSeparator />
          <DropdownLabel className={MENU_HEADING_CLASS}>
            Playbooks
          </DropdownLabel>
          {choices.playbooks.length === 0 && (
            <DropdownItem disabled>
              {choices.loading ? "Loading…" : "No playbooks"}
            </DropdownItem>
          )}
          {choices.playbooks.map((c) => (
            <DropdownRadioItem
              key={c.id}
              value={refKey({ kind: "playbook", id: c.id })}
            >
              <PlaybookSkeuoIcon className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{c.name}</span>
            </DropdownRadioItem>
          ))}
          {choices.failed && (
            <DropdownItem disabled>
              Couldn&rsquo;t load every workflow and playbook.
            </DropdownItem>
          )}
        </DropdownRadioGroup>
      </DropdownContent>
    </Dropdown>
  );
}

/** The table's rows while the rules load. */
function RulesLoadingRows() {
  return (
    <TableBody
      aria-busy="true"
      aria-label="Loading the rules"
      className={TABLE_MIN_WIDTH}
    >
      {Array.from({ length: 3 }, (_, row) => (
        <TableRow key={row} interactive={false} className={TABLE_MIN_WIDTH}>
          <TableCell className={COLUMNS.number}>
            {/* In the checkbox's place. */}
            <span className="mr-3 h-2.5 w-2.5 shrink-0 animate-pulse rounded bg-gray-100 motion-reduce:animate-none" />
            <span className={cn(PRIORITY_CLASS, "flex justify-end")}>
              <SkeletonLine className="w-3" />
            </span>
          </TableCell>
          <TableCell className={COLUMNS.condition}>
            <SkeletonLine className="w-2/3" />
          </TableCell>
          <TableCell className={COLUMNS.assignee}>
            <SkeletonLine className="w-28" />
          </TableCell>
          <TableCell className={COLUMNS.preprocess}>
            <SkeletonLine className="w-8" />
          </TableCell>
          <TableCell className={COLUMNS.preprocessWith}>
            <SkeletonLine className="w-32" />
          </TableCell>
          <TableCell className={COLUMNS.actions}>
            <SkeletonLine className="w-4" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
