import fs from 'node:fs/promises';

const file = 'src/app.js';
let source = await fs.readFile(file, 'utf8');

if (!source.includes('DraggableBottomSheet')) {
  source =
`import {
  DraggableBottomSheet
} from './ui/draggable-bottom-sheet.js';
import './ui/draggable-bottom-sheet.css';
` + source;
}

source = source.replace(
  /root\.querySelector\('#sheetToggle'\)\.addEventListener\('click',[\s\S]*?\n\s*\}\);/,
  `draggableSheet = new DraggableBottomSheet({
    sheet: bottomSheet,
    handle: root.querySelector('#sheetToggle'),
    initialSnap: 'half',
    onSettled: () => {
      window.setTimeout(
        () => map.invalidateSize(),
        300
      );
    }
  });`
);

source = source.replace(
  `const expandSheet = () => bottomSheet.classList.remove('collapsed');`,
  `let draggableSheet = null;

  const expandSheet = () => {
    draggableSheet?.expand();
  };`
);

await fs.writeFile(file, source, 'utf8');
console.log('Draggable bottom sheet enabled.');
