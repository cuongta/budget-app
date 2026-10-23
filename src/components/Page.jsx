import "./Page.css";

/**
 * Shared page shell, so every page has the same width, padding and header:
 * title (+ optional subtitle) on the left, page controls (`actions`) on the right.
 * The header always renders, so loading/error states don't make the page jump.
 */
export const Page = ({ title, subtitle, actions, children }) => (
  <div className="page">
    <header className="page__header">
      <div className="page__heading">
        <h1 className="page__title">{title}</h1>
        {subtitle && <p className="page__subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page__actions">{actions}</div>}
    </header>
    {children}
  </div>
);

/** A titled block on a page; `hint` is a muted line under the title. */
export const Section = ({ title, hint, children }) => (
  <section className="page__section">
    {title && <h2 className="page__section-title">{title}</h2>}
    {hint && <div className="page__hint">{hint}</div>}
    {children}
  </section>
);

/** Loading / empty / error message, styled the same on every page. */
export const Status = ({ error, children }) => (
  <p className={`page__status${error ? " page__status--error" : ""}`}>{children}</p>
);
