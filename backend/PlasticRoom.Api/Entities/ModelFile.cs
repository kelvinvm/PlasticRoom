using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

[Persistent("File")]
public class ModelFile : XPObject
{
    public ModelFile(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private ModelFileType type;
    public ModelFileType Type
    {
        get => type;
        set => SetPropertyValue(nameof(Type), ref type, value);
    }

    private long sizeBytes;
    public long SizeBytes
    {
        get => sizeBytes;
        set => SetPropertyValue(nameof(SizeBytes), ref sizeBytes, value);
    }

    private System.DateTime addedAt;
    public System.DateTime AddedAt
    {
        get => addedAt;
        set => SetPropertyValue(nameof(AddedAt), ref addedAt, value);
    }

    private double? dimXMm;
    public double? DimXMm
    {
        get => dimXMm;
        set => SetPropertyValue(nameof(DimXMm), ref dimXMm, value);
    }

    private double? dimYMm;
    public double? DimYMm
    {
        get => dimYMm;
        set => SetPropertyValue(nameof(DimYMm), ref dimYMm, value);
    }

    private double? dimZMm;
    public double? DimZMm
    {
        get => dimZMm;
        set => SetPropertyValue(nameof(DimZMm), ref dimZMm, value);
    }

    private int? plateCount;
    public int? PlateCount
    {
        get => plateCount;
        set => SetPropertyValue(nameof(PlateCount), ref plateCount, value);
    }

    private int? estPrintTimeMin;
    public int? EstPrintTimeMin
    {
        get => estPrintTimeMin;
        set => SetPropertyValue(nameof(EstPrintTimeMin), ref estPrintTimeMin, value);
    }

    private string? material;
    public string? Material
    {
        get => material;
        set => SetPropertyValue(nameof(Material), ref material, value);
    }

    private double? layerHeightMm;
    public double? LayerHeightMm
    {
        get => layerHeightMm;
        set => SetPropertyValue(nameof(LayerHeightMm), ref layerHeightMm, value);
    }

    private string? sourceUrl;
    public string? SourceUrl
    {
        get => sourceUrl;
        set => SetPropertyValue(nameof(SourceUrl), ref sourceUrl, value);
    }

    private string? creator;
    public string? Creator
    {
        get => creator;
        set => SetPropertyValue(nameof(Creator), ref creator, value);
    }

    private string? description;
    public string? Description
    {
        get => description;
        set => SetPropertyValue(nameof(Description), ref description, value);
    }

    private string storagePath = string.Empty;
    public string StoragePath
    {
        get => storagePath;
        set => SetPropertyValue(nameof(StoragePath), ref storagePath, value);
    }

    private string? thumbnailPath;
    public string? ThumbnailPath
    {
        get => thumbnailPath;
        set => SetPropertyValue(nameof(ThumbnailPath), ref thumbnailPath, value);
    }

    [Association("File-FileFolders")]
    public XPCollection<FileFolder> FileFolders => GetCollection<FileFolder>(nameof(FileFolders));

    [Association("File-FileTags")]
    public XPCollection<FileTag> FileTags => GetCollection<FileTag>(nameof(FileTags));

    [Association("File-Plates")]
    public XPCollection<Plate> Plates => GetCollection<Plate>(nameof(Plates));

    private Model? model;
    [Association("Model-ModelFiles")]
    public Model? Model
    {
        get => model;
        set => SetPropertyValue(nameof(Model), ref model, value);
    }
}
