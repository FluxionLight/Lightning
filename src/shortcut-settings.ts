import { ShortcutManager, comboFromEvent, formatCombo } from "./shortcuts";

/** Preference capture stays in its dialog; 阅读 shortcuts never run while recording. */
export function openShortcutSettings(manager: ShortcutManager): void {
  if (document.querySelector("dialog[open]")) return;
  manager.releaseAll();
  const dialog = document.createElement("dialog"); dialog.className = "reader-settings shortcut-settings";
  dialog.innerHTML = `<h2>快捷键设置</h2><p class="muted">点击组合后按键即可保存。空白操作可自行绑定；按住类操作在松开时恢复。设置保存在本机，所有文档共用。Esc 取消录入。</p><p class="settings-error" role="alert"></p><div class="shortcut-list"></div><div class="settings-actions"><button class="btn shortcut-reset">恢复默认</button><button class="btn primary shortcut-close">关闭</button></div>`;
  const list = dialog.querySelector<HTMLElement>(".shortcut-list")!;
  const error = dialog.querySelector<HTMLElement>(".settings-error")!;
  const attempt = (run: () => void) => { try { run(); error.textContent = ""; render(); } catch (e) { error.textContent = String(e); } };
  const render = () => {
    list.replaceChildren();
    for (const command of manager.list()) {
      const row = document.createElement("div"); row.className = "shortcut-row"; row.dataset.command = command.id;
      const label = document.createElement("span"); label.textContent = command.description;
      const capture = document.createElement("button"); capture.className = "btn shortcut-capture"; capture.textContent = formatCombo(command.combo);
      capture.setAttribute("aria-label", `设置${command.description}快捷键`);
      capture.onclick = () => {
        capture.textContent = "请按组合键…"; capture.dataset.recording = "true"; capture.focus();
        capture.onkeydown = event => {
          event.preventDefault(); event.stopPropagation();
          if (event.key === "Escape") { render(); return; }
          if (event.isComposing || event.repeat || ["Control","Alt","Shift","Meta"].includes(event.key)) return;
          attempt(() => manager.setBinding(command.id, comboFromEvent(event)));
        };
        capture.onblur = () => { capture.onkeydown = null; delete capture.dataset.recording; capture.textContent = formatCombo(manager.list().find(c => c.id === command.id)!.combo); };
      };
      const clear = document.createElement("button"); clear.className = "btn shortcut-clear"; clear.textContent = "清除"; clear.disabled = !command.combo;
      clear.onclick = () => attempt(() => manager.setBinding(command.id, null));
      row.append(label, capture, clear); list.append(row);
    }
  };
  dialog.querySelector<HTMLButtonElement>(".shortcut-reset")!.onclick = () => attempt(() => manager.reset());
  dialog.querySelector<HTMLButtonElement>(".shortcut-close")!.onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog); render(); dialog.showModal();
}
