import { DEFAULT_LASER, PdfLaser } from "./pdf-laser";

export function openLaserSettings(laser: PdfLaser, status: (text: string, error?: boolean) => void): void {
  if (document.querySelector("dialog[open]")) return;
  laser.clear();
  const dialog = document.createElement("dialog"); dialog.className = "reader-settings laser-settings";
  dialog.innerHTML = `<form><h2>激光笔设置</h2>
    <p class="muted">按住鼠标时笔迹一直保留；松开后开始计时。消失前再次落笔，会恢复并保留这一组笔迹。Esc 退出用笔。</p>
    <div class="laser-settings-grid">
      <label>激光笔颜色<input name="laserColor" type="color" required></label>
      <label>激光荧光笔颜色<input name="highlighterColor" type="color" required></label>
      <label>激光笔粗细（像素）<input name="laserWidth" type="number" min="1" max="12" step="0.5" required></label>
      <label>荧光笔粗细（像素）<input name="highlighterWidth" type="number" min="6" max="60" step="1" required></label>
      <label>松开后停留（秒）<input name="holdSeconds" type="number" min="0" max="30" step="0.1" required></label>
      <label>渐隐时长（秒）<input name="fadeSeconds" type="number" min="0.1" max="10" step="0.1" required></label>
    </div>
    <p class="laser-total muted" aria-live="polite"></p>
    <p class="muted">颜色、粗细与时间保存在本机，所有文档共用。笔迹仅临时显示，翻页、缩放或切换文件会清除。</p>
    <div class="settings-actions"><button type="button" class="btn laser-reset">恢复默认</button><button type="button" class="btn laser-cancel">取消</button><button type="submit" class="btn primary">保存</button></div></form>`;
  const form = dialog.querySelector("form")!;
  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement;
  const total = () => {
    const seconds = input("holdSeconds").valueAsNumber + input("fadeSeconds").valueAsNumber;
    dialog.querySelector(".laser-total")!.textContent = Number.isFinite(seconds) ? `最后一次松开后 ${(Math.round(seconds * 10) / 10).toFixed(1)} 秒完全消失。` : "请填写有效的时间。";
  };
  const fill = (value: typeof DEFAULT_LASER) => { for (const [key, field] of Object.entries(value)) input(key).value = String(field); total(); };
  fill(laser.settings); form.oninput = total;
  dialog.querySelector<HTMLButtonElement>(".laser-reset")!.onclick = () => fill(DEFAULT_LASER);
  dialog.querySelector<HTMLButtonElement>(".laser-cancel")!.onclick = () => dialog.close();
  form.onsubmit = event => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const saved = laser.setPreferences({ laserColor: input("laserColor").value, highlighterColor: input("highlighterColor").value,
      laserWidth: input("laserWidth").valueAsNumber, highlighterWidth: input("highlighterWidth").valueAsNumber,
      holdSeconds: input("holdSeconds").valueAsNumber, fadeSeconds: input("fadeSeconds").valueAsNumber });
    status(saved ? "激光笔设置已保存" : "设置本次已生效，但无法保存本机偏好", !saved); dialog.close();
  };
  dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
}
