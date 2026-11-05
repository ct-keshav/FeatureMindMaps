import { fieldText, HEADER_FIELDS, humanize, isOpen } from '../lib/tracker.js';

/** Box-drawing characters (─ │ ┌ ┼ …): lines containing them are rendered as a monospace table. */
const TABLE_LINE = /[─-╿]/;
/** Fields longer than this (or multi-line) collapse behind a <details>. */
const COLLAPSE_AT = 280;

/** Splits text into prose paragraphs and box-drawing tables. */
function RichText({ text }) {
  const blocks = [];
  for (const line of text.split('\n')) {
    const table = TABLE_LINE.test(line);
    const last = blocks[blocks.length - 1];
    if (last && last.table === table) last.lines.push(line);
    else blocks.push({ table, lines: [line] });
  }
  return blocks.map((block, i) => {
    const body = block.lines.join('\n');
    if (block.table) {
      return (
        <pre className="field-table" key={i}>
          {body}
        </pre>
      );
    }
    return (
      body.trim() && (
        <p className="field-prose" key={i}>
          {body.trim()}
        </p>
      )
    );
  });
}

function Field({ name, text }) {
  const label = humanize(name);
  if (text.includes('\n') || text.length > COLLAPSE_AT) {
    return (
      <details className="field">
        <summary>{label}</summary>
        <RichText text={text} />
      </details>
    );
  }
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <p>{text}</p>
    </div>
  );
}

function Item({ item }) {
  const fields = Object.entries(item)
    .filter(([key]) => !HEADER_FIELDS.has(key))
    .map(([key, value]) => [key, fieldText(value)])
    .filter(([, text]) => text);

  return (
    <li className="item">
      {(item.status || item.owner) && (
        <div className="meta">
          {item.status && <span className={isOpen(item) ? 'chip' : 'chip closed'}>{item.status}</span>}
          {item.owner && <span>{item.owner}</span>}
        </div>
      )}
      <h3>{item.title}</h3>
      {fields.map(([key, text]) => (
        <Field key={key} name={key} text={text} />
      ))}
    </li>
  );
}

export function TrackerDrawer({ ref, open, panel, items, error, onClose }) {
  let body;
  if (error) body = <p className="empty">Couldn’t load tracker.json ({error}).</p>;
  else if (!items) body = <p className="empty">Loading…</p>;
  else if (!items.length) body = <p className="empty">{panel?.empty}</p>;
  else
    body = (
      <ul className="items">
        {items.map((item, i) => (
          <Item key={i} item={item} />
        ))}
      </ul>
    );

  return (
    <aside
      id="drawer"
      ref={ref}
      className={`drawer tone-${panel?.tone ?? 'critical'}`}
      data-open={open}
      data-own-keys=""
      inert={!open}
      tabIndex={-1}
      aria-labelledby="drawer-title"
    >
      <header className="drawer-head">
        <h2 id="drawer-title">
          <span className="dot" aria-hidden="true" />
          {panel?.label}
          {items && (
            <span className="badge" title="Open items">
              {items.filter(isOpen).length}
            </span>
          )}
        </h2>
        <button className="close" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
          ×
        </button>
      </header>
      <div className="drawer-body">{body}</div>
    </aside>
  );
}
