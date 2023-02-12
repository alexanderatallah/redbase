import { Tag } from '../src/tag'

describe('Tag', () => {
  it('should be able to create a tag by constructor', () => {
    const tag = new Tag('test')
    expect(tag).toBeTruthy()
    expect(tag.name).toEqual('test')
    expect(tag.parent).toBeUndefined()
  })

  it('should be able to create a root tag by static method', () => {
    const tag = Tag.root()
    const tag2 = Tag.root()
    expect(tag === tag2).toBeTruthy()
  })

  it('should be able to create a root tag by path', () => {
    const tag = Tag.fromPath('')
    expect(tag).toEqual(Tag.root())

    const tag2 = Tag.fromPath('/')
    expect(tag2).toEqual(Tag.root())
  })

  it('should be able to create a simple tag by path', () => {
    const tag = Tag.fromPath('test')
    expect(tag.name).toEqual('test')
    expect(tag.parent).toEqual(Tag.root())
  })

  it('should be able to create a simple tag by path, slash suffix', () => {
    const tag = Tag.fromPath('test/')
    expect(tag.name).toEqual('test')
    expect(tag.parent).toEqual(Tag.root())
  })

  it('should be able to create a complex tag by path', () => {
    const tag = Tag.fromPath('test/child')
    expect(tag.name).toEqual('test/child')
    expect(tag.parent?.name).toEqual('test')
  })

  it('should be able to create a slash-prepended tag by path', () => {
    const tag = Tag.fromPath('/test/child')
    expect(tag.name).toEqual('/test/child')
    expect(tag.parent?.name).toEqual('/test')
    expect(tag.parent?.parent).toEqual(Tag.root())
  })
})
