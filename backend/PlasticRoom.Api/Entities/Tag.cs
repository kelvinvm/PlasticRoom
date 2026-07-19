using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Tag : XPObject
{
    public Tag(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private string? colorKey;
    public string? ColorKey
    {
        get => colorKey;
        set => SetPropertyValue(nameof(ColorKey), ref colorKey, value);
    }

    [Association("Tag-FileTags")]
    public XPCollection<FileTag> FileTags => GetCollection<FileTag>(nameof(FileTags));

    [Association("Tag-ModelTags")]
    public XPCollection<ModelTag> ModelTags => GetCollection<ModelTag>(nameof(ModelTags));
}
