import { describe, expect, it } from "vitest";
import type { Bookmark, OrganizationFolder, OrganizationOperation } from "@bookmark-ai/types";
import { changedBookmarkFields, expectedBookmarkVersions, invalidFolderDestinations, itemResultSummary, operationSummary } from "./organization-ui";
describe("organization editing semantics", () => {
  it("title-only edits preserve legacy labels above the current tag cap", () => {
    const bookmark={title:"Old",tags:Array.from({length:15},(_,i)=>`legacy-${i}`),folderId:null,categoryId:null,readingState:"not_on_list"} as Bookmark;
    expect(changedBookmarkFields(bookmark,{...bookmark,title:"New",folderId:null,categoryId:null,readingState:"not_on_list"})).toEqual({title:"New"});
    expect(expectedBookmarkVersions(bookmark).folderId).toBe("0");
  });
  it("excludes a moving folder and every descendant, independent of row order", () => {
    const folders=[{id:"grandchild",parentId:"child"},{id:"other",parentId:null},{id:"child",parentId:"parent"},{id:"parent",parentId:null}] as OrganizationFolder[];
    expect([...invalidFolderDestinations(folders,"parent")].sort()).toEqual(["child","grandchild","parent"]);
  });
  it("describes partially restored Undo fields despite item-level conflict", () => {
    const result={id:"a",status:"conflict" as const,changedFields:["readingState"],error:{code:"conflict",message:"Title changed later",fields:["title"]}};
    expect(itemResultSummary(result,true)).toBe("Restored: reading state. Kept newer values: title");
    expect(operationSummary({description:"Undo edit",undoOf:"before",succeededCount:0,failedCount:1,succeededFieldCount:1,results:[result]} as OrganizationOperation)).toContain("1 fields restored across 1 items");
  });
});

describe("organization navigation and history", () => {
  it("orders parents before children, alphabetizes siblings and retains full paths", async () => {
    const {folderTreeRows}=await import("./organization-ui");
    const rows=folderTreeRows([{id:"child",parentId:"parent",name:"Alpha child",path:"Zebra / Alpha child"},{id:"parent",parentId:null,name:"Zebra",path:"Zebra"},{id:"other",parentId:null,name:"Apple",path:"Apple"}] as OrganizationFolder[]);
    expect(rows.map(row=>[row.folder.id,row.depth,row.ancestors])).toEqual([["other",0,[]],["parent",0,[]],["child",1,["parent"]]]);
    expect(rows[1].hasChildren).toBe(true);
  });
  it("describes actual moved items and keeps conflict counts explicit", () => {
    expect(operationSummary({action:"bookmarks.update",description:"Update bookmarks",failedCount:1,results:[{id:"a",status:"succeeded",changedFields:["folderId"]},{id:"b",status:"conflict",error:{fields:["folderId"]}}]} as OrganizationOperation)).toBe("Moved 1 bookmark, 1 need review");
  });
});

describe("folder disclosure and search", () => {
  const folders = [
    { id: "child", parentId: "parent", name: "Research", path: "Work / Research" },
    { id: "leaf", parentId: "child", name: "Reading", path: "Work / Research / Reading" },
    { id: "parent", parentId: null, name: "Work", path: "Work" },
    { id: "other", parentId: null, name: "Personal", path: "Personal" },
  ] as OrganizationFolder[];
  it("hides descendants of collapsed folders but search still finds their full paths", async () => {
    const { visibleFolderRows } = await import("./organization-ui");
    expect(visibleFolderRows(folders, new Set(["parent"])).map(r => r.folder.id)).toEqual(["other", "parent"]);
    const found = visibleFolderRows(folders, new Set(["parent"]), "  READING  ");
    expect(found.map(r => [r.folder.id, r.folder.path, r.ancestors])).toEqual([["leaf", "Work / Research / Reading", ["parent", "child"]]]);
    expect(visibleFolderRows(folders, new Set(["parent"]), "Work / Research").map(r => r.folder.id)).toEqual(["child", "leaf"]);
  });
  it("restores descendants when expanded, and retains children after a parent disappears", async () => {
    const { visibleFolderRows } = await import("./organization-ui");
    expect(visibleFolderRows(folders, new Set()).map(r => r.folder.id)).toEqual(["other", "parent", "child", "leaf"]);
    const remaining = folders.filter(f => f.id !== "parent");
    expect(visibleFolderRows(remaining, new Set(["parent"])).map(r => [r.folder.id, r.depth])).toEqual([["other", 0], ["child", 0], ["leaf", 1]]);
    expect(visibleFolderRows(remaining, new Set(["child"])).map(r => r.folder.id)).toEqual(["other", "child"]);
  });
  it("keeps valid siblings readable when malformed cyclic or orphaned data arrives", async () => {
    const { folderTreeRows } = await import("./organization-ui");
    const malformed = [...folders, { id: "a", parentId: "b", name: "A", path: "A" }, { id: "b", parentId: "a", name: "B", path: "B" } ] as OrganizationFolder[];
    const rows = folderTreeRows(malformed);
    expect(rows).toHaveLength(malformed.length);
    expect(new Set(rows.map(r => r.folder.id)).size).toBe(malformed.length);
    expect(rows.slice(0, 4).map(r => r.folder.id)).toEqual(["other", "parent", "child", "leaf"]);
  });
  it("returns a genuine empty search result without changing the tree", async () => {
    const { visibleFolderRows } = await import("./organization-ui");
    expect(visibleFolderRows(folders, new Set(), "missing")).toEqual([]);
    expect(visibleFolderRows([], new Set(["removed"]))).toEqual([]);
  });
});
