using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Designer : XPObject
{
    public Designer(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    [Association("Designer-Models")]
    public XPCollection<Model> Models => GetCollection<Model>(nameof(Models));
}
