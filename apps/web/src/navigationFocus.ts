/** Give keyboard and screen-reader users a destination when hash navigation swaps the page. */
export function focusRouteContent(): void {
  window.scrollTo(0, 0);
  const main = document.querySelector<HTMLElement>("main");
  const target = main?.querySelector<HTMLElement>("h1") ?? main;
  if (!target) return;
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
}
