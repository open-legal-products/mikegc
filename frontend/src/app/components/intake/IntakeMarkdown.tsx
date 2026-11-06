"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Activity text sized like a note. Headings step down to the note's scale,
 * since a report sits inside a timeline entry, not a page.
 */
const components: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-gray-900 first:mt-0">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-1 mt-3 text-sm font-semibold text-gray-900 first:mt-0">
      {children}
    </h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-1 mt-2 text-sm font-medium text-gray-900 first:mt-0">
      {children}
    </h4>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 text-sm font-medium text-gray-900 first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0">{children}</ul>
  ),
  // A list that picks up at "3." keeps its numbering.
  ol: ({ start, children }) => (
    <ol start={start} className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0">
      {children}
    </ol>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-900">{children}</strong>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline underline-offset-2 hover:text-blue-700"
    >
      {children}
    </a>
  ),
  // The report draws on the requester's text: an image would load from
  // wherever it points, so only its description is shown.
  img: ({ alt }) => (alt ? <span>{alt}</span> : null),
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-gray-200 pl-3 text-gray-600 last:mb-0">
      {children}
    </blockquote>
  ),
  code: ({ children }) => (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.8125rem]">
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-gray-100 p-3 last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  hr: () => <hr className="my-3 border-gray-200" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto rounded-md border border-gray-200 last:mb-0">
      <table className="min-w-full border-collapse text-left text-xs leading-5">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-r border-gray-200 px-3 py-2 font-medium text-gray-900 last:border-r-0">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-r border-gray-200 px-3 py-2 align-top last:border-r-0">
      {children}
    </td>
  ),
};

/**
 * Markdown in the request's Activity, such as MikeGC's preprocessing report.
 * Raw HTML is never rendered, and unsafe link schemes are dropped.
 */
export function IntakeMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 text-sm leading-relaxed text-gray-700 [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
