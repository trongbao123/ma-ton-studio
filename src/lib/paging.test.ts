import { describe, expect, it } from "vitest";
import { pageList } from "./paging";

describe("pageList", () => {
  it("ít trang thì hiện hết", () => expect(pageList(1, 3)).toEqual([1, 2, 3]));
  it("nhiều trang thì rút gọn bằng …", () => expect(pageList(5, 10)).toEqual([1, null, 4, 5, 6, null, 10]));
  it("trang đầu", () => expect(pageList(1, 10)).toEqual([1, 2, null, 10]));
});
