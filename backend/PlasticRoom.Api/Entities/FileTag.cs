using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class FileTag : XPObject
{
    public FileTag(Session session) : base(session)
    {
    }

    private ModelFile file = null!;
    [Association("File-FileTags")]
    public ModelFile File
    {
        get => file;
        set => SetPropertyValue(nameof(File), ref file, value);
    }

    private Tag tag = null!;
    [Association("Tag-FileTags")]
    public Tag Tag
    {
        get => tag;
        set => SetPropertyValue(nameof(Tag), ref tag, value);
    }
}
