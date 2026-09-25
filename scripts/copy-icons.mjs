import { cpSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// tsc only emits .js; the node and credential icons have to sit next to them in dist/.
function copySvgs(dir) {
	for (const entry of readdirSync(dir)) {
		const src = join(dir, entry);
		if (statSync(src).isDirectory()) copySvgs(src);
		else if (entry.endsWith('.svg')) cpSync(src, join('dist', src));
	}
}
copySvgs('nodes');
copySvgs('credentials');
