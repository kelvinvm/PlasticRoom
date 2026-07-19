namespace PlasticRoom.Cli;

public class SystemConsoleIO : IConsoleIO
{
    public void WriteLine(string message) => System.Console.WriteLine(message);
    public string? ReadLine() => System.Console.ReadLine();
}
