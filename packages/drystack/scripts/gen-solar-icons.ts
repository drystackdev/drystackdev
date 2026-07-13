import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { getIconData } from '@iconify/utils';
import solarIconSet from '@iconify-json/solar/icons.json' with { type: 'json' };
import iconMap from './solar-icon-map.json' with { type: 'json' };

function normalizeBody(body: string) {
  return body
    .replace(/\s*fill="none"/g, '')
    .replace(/\s*stroke="currentColor"/g, '')
    .replace(/\s*stroke-width="[\d.]+"/g, '')
    // Iconify ships plain SVG/HTML attribute names; JSX/TypeScript's SVGProps
    // types only recognize the camelCase React prop names.
    .replace(/\bstroke-linecap=/g, 'strokeLinecap=')
    .replace(/\bstroke-linejoin=/g, 'strokeLinejoin=')
    .replace(/\bstroke-dasharray=/g, 'strokeDasharray=')
    .replace(/\bstroke-miterlimit=/g, 'strokeMiterlimit=')
    .replace(/\bfill-rule=/g, 'fillRule=')
    .replace(/\bclip-rule=/g, 'clipRule=')
    .trim();
}

function assertBalanced(exportName: string, body: string) {
  const opens = body.match(/<(?!\/)[a-zA-Z][^/>]*?(?<!\/)>/g) ?? [];
  const closes = body.match(/<\/[a-zA-Z]+>/g) ?? [];
  if (opens.length !== closes.length) {
    throw new Error(
      `Malformed SVG body for "${exportName}": ${opens.length} open tags vs ${closes.length} close tags`
    );
  }
}

(async () => {
  const outDir = fileURLToPath(new URL('../src/app/icons/', import.meta.url));
  await fs.mkdir(outDir, { recursive: true });

  const files: { exportName: string; contents: string }[] = [];

  for (const [exportName, slug] of Object.entries(iconMap)) {
    const data = getIconData(solarIconSet, slug);
    if (!data) {
      throw new Error(`Unknown solar icon "${slug}" (mapped from "${exportName}")`);
    }
    const body = normalizeBody(data.body);
    assertBalanced(exportName, body);
    const contents = `/** ![${exportName}](solar:${slug}) */\nexport const ${exportName} = ${body};\n`;
    files.push({ exportName, contents });
  }

  // only write once every icon has generated successfully — no partial writes on failure
  for (const { exportName, contents } of files) {
    await fs.writeFile(`${outDir}${exportName}.tsx`, contents);
  }

  console.log(`Generated ${files.length} icon(s) in ${outDir}`);
})();
