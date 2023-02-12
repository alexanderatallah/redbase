export class Tag {
  public readonly name: string // blank name means root tag
  public readonly parent?: Tag

  private static _rootSingleton: Tag

  constructor(name?: string, parent?: Tag) {
    this.name = name || ''
    this.parent = parent
  }

  static root(): Tag {
    if (!Tag._rootSingleton) {
      Tag._rootSingleton = new Tag()
    }
    return Tag._rootSingleton
  }

  static fromPath(tagName: string, separator = '/'): Tag {
    // Input: "/a/b/c"
    // Output: ["", "/a", "/a/b", "/a/b/c"]
    // Invalid: "/", "/a/b/c/"
    if (tagName?.endsWith(separator)) {
      tagName = tagName.slice(0, -1)
    }
    if (!tagName) {
      // Root node
      return Tag.root()
    }
    const parentName = tagName.split(separator).slice(0, -1).join(separator)
    return new Tag(tagName, Tag.fromPath(parentName))
  }

  get key(): string {
    const suffix = this.name ? `:${this.name}` : ''
    return `tag${suffix}`
  }
}
