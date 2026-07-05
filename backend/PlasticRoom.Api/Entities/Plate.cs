using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Plate : XPObject
{
    public Plate(Session session) : base(session)
    {
    }

    private ModelFile file = null!;
    [Association("File-Plates")]
    public ModelFile File
    {
        get => file;
        set => SetPropertyValue(nameof(File), ref file, value);
    }

    private int index;
    public int Index
    {
        get => index;
        set => SetPropertyValue(nameof(Index), ref index, value);
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private string? thumbnailPath;
    public string? ThumbnailPath
    {
        get => thumbnailPath;
        set => SetPropertyValue(nameof(ThumbnailPath), ref thumbnailPath, value);
    }

    // Comma-separated 0-based indices into the 3MF <build> item order, e.g. "0,2,5".
    private string buildItemIndices = string.Empty;
    public string BuildItemIndices
    {
        get => buildItemIndices;
        set => SetPropertyValue(nameof(BuildItemIndices), ref buildItemIndices, value);
    }
}
