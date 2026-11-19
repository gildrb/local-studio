import Foundation

public enum Record: Sendable, Equatable {
    case frame(Data)
    case blob(id: Data, final: Bool, data: Data)
}

public struct RecordReader: Sendable {
    public static let maxFrame = 8 * 1024 * 1024
    private var pending = Data()

    public init() {}

    public mutating func read(_ plaintext: Data) throws -> Record? {
        guard let kind = plaintext.first else {
            throw RemoteError.unexpected("an empty record")
        }
        let body = plaintext.dropFirst()
        switch kind {
        case 0x01, 0x02:
            guard pending.count + body.count <= Self.maxFrame else {
                throw RemoteError.unexpected("a JSON frame over 8 MiB")
            }
            pending.append(body)
            guard kind == 0x01 else {
                return nil
            }
            defer { pending = Data() }
            return .frame(pending)
        case 0x03:
            guard pending.isEmpty else {
                throw RemoteError.unexpected("a blob record inside a JSON frame")
            }
            guard body.count >= 17 else {
                throw RemoteError.unexpected("a short blob record")
            }
            let start = body.startIndex
            return .blob(id: Data(body[start ..< start + 16]), final: body[start + 16] & 1 == 1, data: Data(body[(start + 17)...]))
        default:
            throw RemoteError.unexpected("an unknown record type \(kind)")
        }
    }
}

public enum RecordWriter {
    public static let maxMessage = 65_535
    public static let sealOverhead = 16
    public static let maxChunk = maxMessage - sealOverhead - 1

    public static func frame(_ json: Data) throws -> [Data] {
        guard json.count <= RecordReader.maxFrame else {
            throw RemoteError.unexpected("a JSON frame over 8 MiB")
        }
        var records: [Data] = []
        var offset = json.startIndex
        repeat {
            let end = min(offset + maxChunk, json.endIndex)
            var record = Data([end == json.endIndex ? 0x01 : 0x02])
            record.append(json[offset ..< end])
            records.append(record)
            offset = end
        } while offset < json.endIndex
        return records
    }
}
