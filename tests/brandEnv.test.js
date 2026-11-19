/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

// The bot names itself KkthnxUI / KkthnxBot unless .env overrides it, and no
// leftover community-bot naming may creep back into member-facing text.

const fs = require('fs');
const path = require('path');
const { brandFromEnv, parseHexColor } = require('../src/utils/brand');

describe('brandFromEnv', () => {
    test('defaults to KkthnxUI and KkthnxBot', () => {
        const b = brandFromEnv({});
        expect(b.community).toBe('KkthnxUI');
        expect(b.bot).toBe('KkthnxBot');
        expect(b.footer).toBe('KkthnxUI');
        expect(b.accent).toBeNull();
    });

    test('reads overrides for a test server', () => {
        const b = brandFromEnv({ BRAND_COMMUNITY: ' KkthnxUI Test ', BRAND_BOT: 'KkthnxBot Dev', BRAND_ACCENT: '#5865F2' });
        expect(b.community).toBe('KkthnxUI Test');
        expect(b.bot).toBe('KkthnxBot Dev');
        expect(b.accent).toBe(0x5865f2);
    });

    test('bad accent values are ignored', () => {
        expect(parseHexColor('red')).toBeNull();
        expect(parseHexColor('#12345')).toBeNull();
        expect(parseHexColor('abcdef')).toBe(0xabcdef);
    });
});

test('no source file mentions the old community bot', () => {
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
    const pattern = new RegExp(['Glitch', 'Haven', 'GLITCH', 'SYSTEM\\.', '\\bXP\\b', '\\bLFG\\b'].join('|'));
    const hits = [];
    for (const file of walk(path.join(__dirname, '../src'))) {
        fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
            if (pattern.test(line)) hits.push(`${path.basename(file)}:${i + 1}`);
        });
    }
    expect(hits).toEqual([]);
});
