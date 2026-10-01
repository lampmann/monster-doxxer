/* Theme files and labels are shared with pmcrwf. */
(async function () {
  const picker = document.getElementById("theme-select");
  const sheet = document.getElementById("theme-css");
  const key = "monster-doxxer-theme";
  try {
    const response = await fetch("css/themes/index.json");
    if (!response.ok) throw new Error("Theme list unavailable");
    const themes = await response.json();
    picker.replaceChildren(...Object.entries(themes).map(([name, file]) => new Option(name, file)));
    const apply = file => {
      if (file) sheet.href = "css/themes/" + file;
      else sheet.removeAttribute("href");
    };
    let saved = "";
    try { saved = localStorage.getItem(key) || ""; } catch (e) {}
    picker.value = Object.values(themes).includes(saved) ? saved : "";
    apply(picker.value);
    picker.addEventListener("change", () => {
      apply(picker.value);
      try { localStorage.setItem(key, picker.value); } catch (e) {}
    });
  } catch (e) {
    picker.disabled = true;
    picker.title = "Theme list unavailable; reload to try again.";
  }
})();
