namespace PlasticRoom.Cli;

public interface IConsoleIO
{
    void WriteLine(string message);
    string? ReadLine();
}
