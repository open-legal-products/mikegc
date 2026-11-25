import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { useIntakeDocumentViewer } from "./IntakeDocuments";

const mocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  listDocumentVersions: vi.fn(),
}));
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
  getDocument: mocks.getDocument,
  listDocumentVersions: mocks.listDocumentVersions,
}));
// A stand-in panel: it asks for the open document's versions, as the real one
// does, and shows what it is handed.
vi.mock("@/app/components/shared/DocumentSidePanel", () => ({
  DocumentSidePanel: (props: {
    doc: { id: string } | null;
    versions: { id: string }[];
    versionsLoading: boolean;
    onLoadVersions: (id: string) => void;
    onClose: () => void;
  }) => {
    const { doc, onLoadVersions } = props;
    useEffect(() => {
      if (doc) onLoadVersions(doc.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [doc?.id]);
    return (
      <div>
        <p>open: {doc?.id ?? "none"}</p>
        <p>versions: {props.versions.map((v) => v.id).join(",") || "none"}</p>
        <p>loading: {String(props.versionsLoading)}</p>
        <button type="button" onClick={props.onClose}>
          close
        </button>
      </div>
    );
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useIntakeDocumentViewer", () => {
  it("keeps the open document's versions when an earlier document's arrive late", async () => {
    type Viewer = ReturnType<typeof useIntakeDocumentViewer>;
    const held: { viewer: Viewer | null } = { viewer: null };
    function Harness({ onViewer }: { onViewer: (viewer: Viewer) => void }) {
      const viewer = useIntakeDocumentViewer();
      useEffect(() => {
        onViewer(viewer);
      });
      return viewer.panel;
    }
    mocks.getDocument.mockImplementation(async (id: string) => ({ id }));
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.listDocumentVersions
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    render(<Harness onViewer={(viewer) => (held.viewer = viewer)} />);

    await act(() => held.viewer!.open("doc-a"));
    await act(() => held.viewer!.open("doc-b"));
    expect(screen.getByText("open: doc-b")).toBeInTheDocument();

    await act(async () =>
      second.resolve({ current_version_id: "b1", versions: [{ id: "b1" }] }),
    );
    expect(screen.getByText("versions: b1")).toBeInTheDocument();
    expect(screen.getByText("loading: false")).toBeInTheDocument();

    // The first document's answer, arriving last, changes nothing.
    await act(async () =>
      first.resolve({ current_version_id: "a1", versions: [{ id: "a1" }] }),
    );
    expect(screen.getByText("versions: b1")).toBeInTheDocument();
  });

  it("keeps the document opened last when an earlier one loads late", async () => {
    type Viewer = ReturnType<typeof useIntakeDocumentViewer>;
    const held: { viewer: Viewer | null } = { viewer: null };
    function Harness() {
      const viewer = useIntakeDocumentViewer();
      useEffect(() => {
        held.viewer = viewer;
      });
      return viewer.panel;
    }
    const slow = deferred<{ id: string }>();
    mocks.getDocument.mockImplementation((id: string) =>
      id === "doc-a" ? slow.promise : Promise.resolve({ id }),
    );
    mocks.listDocumentVersions.mockResolvedValue({ current_version_id: null, versions: [] });
    render(<Harness />);

    let first!: Promise<void>;
    act(() => {
      first = held.viewer!.open("doc-a");
    });
    await act(() => held.viewer!.open("doc-b"));
    expect(screen.getByText("open: doc-b")).toBeInTheDocument();

    await act(async () => {
      slow.resolve({ id: "doc-a" });
      await first;
    });
    expect(screen.getByText("open: doc-b")).toBeInTheDocument();
  });

  it("stays closed when a document asked for before closing arrives after", async () => {
    type Viewer = ReturnType<typeof useIntakeDocumentViewer>;
    const held: { viewer: Viewer | null } = { viewer: null };
    function Harness() {
      const viewer = useIntakeDocumentViewer();
      useEffect(() => {
        held.viewer = viewer;
      });
      return viewer.panel;
    }
    const slow = deferred<{ id: string }>();
    mocks.getDocument.mockImplementation((id: string) =>
      id === "doc-b" ? slow.promise : Promise.resolve({ id }),
    );
    mocks.listDocumentVersions.mockResolvedValue({ current_version_id: null, versions: [] });
    render(<Harness />);

    await act(() => held.viewer!.open("doc-a"));
    expect(screen.getByText("open: doc-a")).toBeInTheDocument();
    let second!: Promise<void>;
    act(() => {
      second = held.viewer!.open("doc-b");
    });
    act(() => screen.getByRole("button", { name: "close" }).click());
    expect(screen.getByText("open: none")).toBeInTheDocument();

    await act(async () => {
      slow.resolve({ id: "doc-b" });
      await second;
    });
    expect(screen.getByText("open: none")).toBeInTheDocument();
  });
});
