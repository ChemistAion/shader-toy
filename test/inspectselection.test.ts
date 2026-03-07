import * as assert from 'assert';

import { isInspectableSelection, resolveInspectableSelection } from '../src/inspectselection';

suite('Inspect selection gate', () => {
    const shader = `
uniform vec3 tint;
#define GAIN 1.25

void main() {
    float value = 0.5;
    int count = 2;
    uvec2 grid = uvec2(1u, 2u);
    bool enabled = true;
    mat2 basis = mat2(1.0);
    vec4 color = vec4(tint, 1.0);
    gl_FragColor = color * value * GAIN;
}
`;

    test('accepts declared numeric variables and swizzles', () => {
        assert.strictEqual(isInspectableSelection(shader, 'value', 5), true);
        assert.strictEqual(isInspectableSelection(shader, 'color.rgb', 6), true);
        assert.strictEqual(isInspectableSelection(shader, 'tint', 6), true);
        assert.strictEqual(isInspectableSelection(shader, 'GAIN', 6), true);
        assert.strictEqual(isInspectableSelection(shader, 'count', 6), true);
        assert.strictEqual(isInspectableSelection(shader, 'grid', 6), true);
    });

    test('normalizes vector swizzle selections to the owning vector', () => {
        assert.deepStrictEqual(resolveInspectableSelection(shader, 'color.r', 6), { variable: 'color', type: 'vec4' });
        assert.deepStrictEqual(resolveInspectableSelection(shader, 'tint.g', 6), { variable: 'tint', type: 'vec3' });
    });

    test('rejects keywords, expressions, and unknown symbols', () => {
        assert.strictEqual(isInspectableSelection(shader, 'for', 5), false);
        assert.strictEqual(isInspectableSelection(shader, 'value + 1.0', 5), false);
        assert.strictEqual(isInspectableSelection(shader, 'missingValue', 5), false);
        assert.strictEqual(isInspectableSelection(shader, 'enabled', 6), false);
        assert.strictEqual(isInspectableSelection(shader, 'basis', 6), false);
    });
});