export function installMapLibreZoomControl(map) {
  if (!map?.getContainer) {
    throw new TypeError(
      'installMapLibreZoomControl requires a MapLibre map.'
    );
  }

  const container = document.createElement('div');
  container.className = 'atlas-maplibre-zoom-control';
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Map zoom');

  const createButton = ({ label, title, action }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return button;
  };

  container.append(
    createButton({
      label: '+',
      title: 'Zoom in',
      action: () => map.zoomIn({ duration: 180 })
    }),
    createButton({
      label: '−',
      title: 'Zoom out',
      action: () => map.zoomOut({ duration: 180 })
    })
  );

  map.getContainer().appendChild(container);
  return container;
}
