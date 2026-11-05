import { splitSearchHighlights } from "./ThreadSearchMatch.logic";

function HighlightedSearchText(props: { text: string; query: string }) {
  if (props.query.trim().length === 0) return props.text;

  return splitSearchHighlights(props.text, props.query).map((part) =>
    part.highlighted ? (
      <mark className="bg-transparent font-semibold text-foreground" key={part.start}>
        {part.text}
      </mark>
    ) : (
      part.text
    ),
  );
}

export function ThreadSearchMatchExcerpt(props: {
  match: {
    readonly source: "user" | "assistant";
    readonly snippet: string;
    readonly query: string;
  };
}) {
  const isUser = props.match.source === "user";
  return (
    <span className="truncate text-xs text-muted-foreground/85">
      <span className={isUser ? "text-info-foreground" : "text-success-foreground"}>
        {isUser ? "You:" : "Agent:"}
      </span>{" "}
      <HighlightedSearchText text={props.match.snippet} query={props.match.query} />
    </span>
  );
}
