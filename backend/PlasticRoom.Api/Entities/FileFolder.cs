using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class FileFolder : XPObject
{
    public FileFolder(Session session) : base(session)
    {
    }

    private ModelFile file = null!;
    [Association("File-FileFolders")]
    public ModelFile File
    {
        get => file;
        set => SetPropertyValue(nameof(File), ref file, value);
    }

    private Folder folder = null!;
    [Association("Folder-FileFolders")]
    public Folder Folder
    {
        get => folder;
        set => SetPropertyValue(nameof(Folder), ref folder, value);
    }
}
