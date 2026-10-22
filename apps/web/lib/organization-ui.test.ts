import { describe, expect, it } from "vitest";
import type { Bookmark, OrganizationOperation } from "@bookmark-ai/types";
import { changedBookmarkFields, expectedBookmarkVersions, itemResultSummary, operationSummary } from "./organization-ui";
describe("organization editing semantics", () => {
  it("title-only edits preserve legacy labels above the current tag cap", () => {
    const bookmark={title:"Old",tags:Array.from({length:15},(_,i)=>`legacy-${i}`),categoryId:null} as Bookmark;
    expect(changedBookmarkFields(bookmark,{...bookmark,title:"New",categoryId:null})).toEqual({title:"New"});
    expect(expectedBookmarkVersions(bookmark).categoryId).toBe("0");
  });
  it("describes partially restored Undo fields despite item-level conflict", () => {
    const result={id:"a",status:"conflict" as const,changedFields:["tags"],error:{code:"conflict",message:"Title changed later",fields:["title"]}};
    expect(itemResultSummary(result,true)).toBe("Restored: tags. Kept newer values: title");
    expect(operationSummary({description:"Undo edit",undoOf:"before",succeededCount:0,failedCount:1,succeededFieldCount:1,results:[result]} as OrganizationOperation)).toContain("1 fields restored across 1 items");
  });
});

it("describes category edits and keeps conflict counts explicit", () => {
  expect(operationSummary({action:"bookmarks.update",description:"Update bookmarks",failedCount:1,results:[{id:"a",status:"succeeded",changedFields:["categoryId"]},{id:"b",status:"conflict",error:{fields:["categoryId"]}}]} as OrganizationOperation)).toBe("Changed category on 1 bookmark, 1 need review");
});
