interface TableSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  resultCount?: number;
  totalCount?: number;
  id?: string;
}

export default function TableSearch({
  value,
  onChange,
  placeholder,
  resultCount,
  totalCount,
  id,
}: TableSearchProps) {
  const showMeta =
    value.trim().length > 0 && resultCount != null && totalCount != null;

  return (
    <div className="table-search">
      <input
        id={id}
        type="search"
        className="input input-sm table-search-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {showMeta && (
        <span className="table-search-meta" aria-live="polite">
          {resultCount} of {totalCount}
        </span>
      )}
      {value && (
        <button
          type="button"
          className="btn btn-ghost btn-sm table-search-clear"
          onClick={() => onChange('')}
        >
          Clear
        </button>
      )}
    </div>
  );
}
