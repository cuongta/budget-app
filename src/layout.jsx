import { NavLink, Outlet } from "react-router";

import "./layout.css";

// NavLink adds aria-current="page" to the link for the current route,
// which .segmented__item uses to highlight it (layout.css).
const PAGES = [
  { to: "/", label: "Home", end: true }, // end: don't also match /settings
  { to: "/monthly", label: "Monthly" },
  { to: "/merchants", label: "Merchants" },
  { to: "/categories", label: "Categories" },
  { to: "/settings", label: "Settings" },
];

export const Layout = () => {
  return (
    <div className="layout">
      {/* no macOS title bar (titleBarStyle: Overlay): drag this bar to move the window */}
      <nav className="titlebar" data-tauri-drag-region>
        <ul className="segmented">
          {PAGES.map(({ to, label, end }) => (
            <li key={to}>
              <NavLink to={to} end={end} className="segmented__item">
                {label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {/* Full-width scroll area, so the scrollbar sits at the window edge while the
          page itself is centered inside (Page.css). */}
      <main className="layout__main">
        <Outlet />
      </main>
    </div>
  );
};
