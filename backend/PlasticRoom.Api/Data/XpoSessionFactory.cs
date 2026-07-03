using System;
using System.IO;
using DevExpress.Xpo;
using DevExpress.Xpo.DB;

namespace PlasticRoom.Api.Data;

public class XpoSessionFactory
{
    private readonly string _connectionString;

    public string DatabasePath { get; }

    public XpoSessionFactory(string? dataPath = null)
    {
        var resolvedDataPath = dataPath
            ?? Environment.GetEnvironmentVariable("DATA_PATH")
            ?? "/data";

        Directory.CreateDirectory(resolvedDataPath);

        DatabasePath = Path.Combine(resolvedDataPath, "plasticroom.db");
        _connectionString = SQLiteConnectionProvider.GetConnectionString(DatabasePath);
    }

    public Session CreateSession()
    {
        // Build a dedicated provider + data layer per session (rather than sharing a single
        // long-lived IDataLayer via XpoDefault.GetDataLayer) and hand the provider's
        // disposables to the Session constructor. This ties the underlying SQLite
        // connection's lifetime to the Session's, so `using var session = ...` reliably
        // releases the native file handle when the session is disposed. Sharing one
        // XpoDefault-managed data layer left the SQLite file handle open for the lifetime
        // of the factory, which is harmless at runtime but breaks temp-directory cleanup
        // in tests on Windows (delete fails with "file in use").
        var provider = SQLiteConnectionProvider.CreateProviderFromString(
            _connectionString, AutoCreateOption.DatabaseAndSchema, out var disposables);
        var dataLayer = new SimpleDataLayer(provider);
        return new Session(dataLayer, disposables);
    }
}
