using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Model : XPObject
{
    public Model(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private Designer designer = null!;
    [Association("Designer-Models")]
    public Designer Designer
    {
        get => designer;
        set => SetPropertyValue(nameof(Designer), ref designer, value);
    }

    private string destinationPath = string.Empty;
    public string DestinationPath
    {
        get => destinationPath;
        set => SetPropertyValue(nameof(DestinationPath), ref destinationPath, value);
    }

    [Association("Model-ModelFiles")]
    public XPCollection<ModelFile> Files => GetCollection<ModelFile>(nameof(Files));

    [Association("Model-ModelTags")]
    public XPCollection<ModelTag> ModelTags => GetCollection<ModelTag>(nameof(ModelTags));
}
