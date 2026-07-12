using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Folder : XPObject
{
    public Folder(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private Folder? parentFolder;
    [Association("Folder-Children")]
    public Folder? ParentFolder
    {
        get => parentFolder;
        set => SetPropertyValue(nameof(ParentFolder), ref parentFolder, value);
    }

    [Association("Folder-Children")]
    public XPCollection<Folder> Children => GetCollection<Folder>(nameof(Children));

    private string? description;
    public string? Description
    {
        get => description;
        set => SetPropertyValue(nameof(Description), ref description, value);
    }

    private ModelFile? coverImageFile;
    public ModelFile? CoverImageFile
    {
        get => coverImageFile;
        set => SetPropertyValue(nameof(CoverImageFile), ref coverImageFile, value);
    }

    private int sortOrder;
    public int SortOrder
    {
        get => sortOrder;
        set => SetPropertyValue(nameof(SortOrder), ref sortOrder, value);
    }

    [Association("Folder-FileFolders")]
    public XPCollection<FileFolder> FileFolders => GetCollection<FileFolder>(nameof(FileFolders));
}
