export function installTracksAndroidFilePickerCompatibility(root) {
  if (!root) return;

  const apply = () => {
    const input = root.querySelector('#tracksFileInput');
    if (!input) return false;

    // Android document providers frequently expose .gpx files with a generic
    // MIME type (for example application/octet-stream). A restrictive accept
    // list therefore hides or disables valid GPX files in Capacitor's WebView
    // chooser. Let the system picker show files and keep Atlas' existing
    // filename/parser validation after selection.
    input.setAttribute('accept', '*/*');
    return true;
  };

  if (apply()) return;

  const observer = new MutationObserver(() => {
    if (!apply()) return;
    observer.disconnect();
  });

  observer.observe(root, {
    childList: true,
    subtree: true
  });
}
