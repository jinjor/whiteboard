import * as assert from "assert";
import { deepEqual } from "../src/deep-equal";

describe("deepEqual", function () {
  it("works", function () {
    assert.deepStrictEqual(deepEqual(undefined, undefined), true);
    assert.deepStrictEqual(deepEqual(null, null), true);
    assert.deepStrictEqual(deepEqual(null, undefined), false);
    assert.deepStrictEqual(deepEqual(0, 0), true);
    assert.deepStrictEqual(deepEqual(0, 1), false);
    assert.deepStrictEqual(deepEqual("", ""), true);
    assert.deepStrictEqual(deepEqual("0", ""), false);
    assert.deepStrictEqual(deepEqual("0", "1"), false);
    assert.deepStrictEqual(deepEqual(0, "0"), false);
    assert.deepStrictEqual(deepEqual([], []), true);
    assert.deepStrictEqual(deepEqual([0], [0]), true);
    assert.deepStrictEqual(deepEqual([0], [1]), false);
    assert.deepStrictEqual(deepEqual([0], [0, 1]), false);
    assert.deepStrictEqual(deepEqual([1, 0], [0, 1]), false);
    assert.deepStrictEqual(deepEqual({}, {}), true);
    assert.deepStrictEqual(deepEqual({ a: 0 }, { a: 0 }), true);
    assert.deepStrictEqual(deepEqual({ a: 0 }, { a: 1 }), false);
    assert.deepStrictEqual(deepEqual({ a: 0 }, { b: 0 }), false);
    assert.deepStrictEqual(deepEqual({}, { a: undefined }), false);
  });
});
