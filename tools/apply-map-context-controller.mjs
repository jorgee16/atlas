    import fs from 'node:fs/promises';

    const file = 'src/app.js';
    let source = await fs.readFile(file, 'utf8');

    if (!source.includes("MapContextController")) {
      source =
    `import {
      MapContextController
    } from './ui/map-context-controller.js';
    ` + source;
    }

    source = source.replace(
      `  const mapContextTitle =
        root.querySelector('#map-context-title');

      const mapContextSubtitle =
        root.querySelector('#map-context-subtitle');`,
      `  const mapContext = new MapContextController({
        titleElement:
          root.querySelector('#map-context-title'),
        subtitleElement:
          root.querySelector('#map-context-subtitle')
      });`
    );

    source = source.replace(
      /mapContextTitle\.textContent\s*=\s*'Exploring';/g,
      `mapContext.showExploring({
        lat,
        lon,
        zoom
      });`
    );

    source = source.replace(
      /mapContextSubtitle\.textContent\s*=\s*`\$\{lat\.toFixed\(4\)\}, \$\{lon\.toFixed\(4\)\} · z\$\{zoom\}`;/g,
      ''
    );

    source = source.replace(
      /mapContextTitle\.textContent\s*=\s*'Following you';\s*mapContextSubtitle\.textContent\s*=\s*Number\.isFinite\(position\.heading\)[\s\S]*?:\s*'Live GPS position';/g,
      `mapContext.showFollowing({
        heading: position.heading,
        speed: position.speed
      });`
    );

    source = source.replace(
      /mapContextTitle\.textContent\s*=\s*'Following you';\s*mapContextSubtitle\.textContent\s*=\s*'Live GPS position';/g,
      `mapContext.showFollowing({
        heading: appState.userPosition?.heading ?? null,
        speed: appState.userPosition?.speed ?? null
      });`
    );

    source = source.replace(
      `      appState.userPosition = {
        name: 'My location',
        lat: position.latitude,
        lon: position.longitude
      };`,
      `      appState.userPosition = {
        name: 'My location',
        lat: position.latitude,
        lon: position.longitude,
        heading: position.heading,
        speed: position.speed
      };`
    );

    source = source.replace(
      `    mapContextTitle.textContent = 'Exploring';`,
      `    mapContext.showExploring({
      lat: mapCenterAnchor?.lat ?? 0,
      lon: mapCenterAnchor?.lon ?? 0,
      zoom: mapCenterAnchor?.zoom ?? 0
    });`
    );

    if (source.includes('mapContextTitle') || source.includes('mapContextSubtitle')) {
      throw new Error(
        'Some direct header updates remain in src/app.js. ' +
        'Inspect them before continuing.'
      );
    }

    await fs.writeFile(file, source, 'utf8');

    console.log(
      'MapContextController now owns the map header.'
    );
