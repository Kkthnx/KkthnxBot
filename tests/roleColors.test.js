/*
 * KkthnxBot. Copyright (c) 2026 Kkthnx. All Rights Reserved.
 * Proprietary and confidential. Unauthorized copying, use, distribution, or
 * modification of this file or any part of it, via any medium, is strictly
 * prohibited. See the LICENSE file for full terms.
 */

const { smartColor } = require('../src/utils/roleColors');

describe('smartColor', () => {
    test('matches known games regardless of case/spacing', () => {
        expect(smartColor('Retail')).toBe('#3fa7ff');
        expect(smartColor('  death   knight ')).toBe('#c41e3a');
    });

    test('matches ping roles', () => {
        expect(smartColor('Release Pings')).toBe('#5cc8ff');
        expect(smartColor('Beta Pings')).toBe('#b483ff');
    });

    test('returns null for unknown names (caller falls back to random)', () => {
        expect(smartColor('Some Indie Game')).toBeNull();
        expect(smartColor('')).toBeNull();
        expect(smartColor(null)).toBeNull();
    });
});
