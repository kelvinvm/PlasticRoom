using System.Collections.Generic;
using PlasticRoom.Cli;

namespace PlasticRoom.Cli.Tests;

public class FakeConsoleIO : IConsoleIO
{
    private readonly Queue<string?> _inputs;
    public List<string> Output { get; } = new();

    public FakeConsoleIO(params string?[] inputs)
    {
        _inputs = new Queue<string?>(inputs);
    }

    public void WriteLine(string message) => Output.Add(message);

    public string? ReadLine() => _inputs.Count > 0 ? _inputs.Dequeue() : null;
}
