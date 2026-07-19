using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class ModelTag : XPObject
{
    public ModelTag(Session session) : base(session)
    {
    }

    private Model model = null!;
    [Association("Model-ModelTags")]
    public Model Model
    {
        get => model;
        set => SetPropertyValue(nameof(Model), ref model, value);
    }

    private Tag tag = null!;
    [Association("Tag-ModelTags")]
    public Tag Tag
    {
        get => tag;
        set => SetPropertyValue(nameof(Tag), ref tag, value);
    }
}
