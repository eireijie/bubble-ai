/**
 * What covers what, lowest first. Anything that opens from inside another layer must sit in a
 * higher one: a dialog opened from Settings goes over Settings, a menu over the dialog.
 */
export const LAYER = {
  /** full-screen sheets and panels over a page */
  sheet: "z-50",
  /** the Settings pop-up (desktop) */
  settings: "z-[60]",
  /** dialogs and sheets, including ones opened from Settings */
  modal: "z-[70]",
  /** menus and pop-overs, over any dialog */
  menu: "z-[100]",
  /** short notices, over everything but the tour */
  toast: "z-[110]",
  tour: "z-[200]",
} as const;

/** The number in a layer's class, to compare two layers. */
export function layerIndex(cls: string): number {
  const m = /z-\[?(\d+)\]?/.exec(cls);
  return m ? Number(m[1]) : 0;
}
