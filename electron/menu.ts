import { Menu, type MenuItemConstructorOptions } from "electron";
import { COMMANDS } from "../shared/commands.js";

export function installMenu(dispatch: (command: string) => void) {
  const commands = (group: string): MenuItemConstructorOptions[] => COMMANDS.filter(item => item.menu === group).map(item => ({
    id: item.id, label: item.accelerator ? item.label : `${item.label}    ${item.key}`,
    ...(item.accelerator ? { accelerator: item.accelerator } : {}), click: () => dispatch(item.id),
  }));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "PageShelf", submenu: [{ label: "关于 PageShelf", click: () => dispatch("about") }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit", label: "退出 PageShelf" }] },
    { label: "编辑", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },
    { label: "显示", submenu: [...commands("view"), { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "前往", submenu: commands("go") },
    { role: "windowMenu" },
  ]));
}
