use serde_json::Value;
use std::collections::HashMap;

// 解析可能包含数组索引的键
// 例如："users[0]" 返回 Some(("users", 0))
fn parse_array_key(key: &str) -> Option<(&str, usize)> {
    if let Some(open_bracket) = key.find('[') {
        if let Some(close_bracket) = key.find(']') {
            if let Ok(index) = key[open_bracket + 1..close_bracket].parse::<usize>() {
                return Some((&key[..open_bracket], index));
            }
        }
    }
    None
}

fn insert_into_map(map: &mut serde_json::Map<String, Value>, path: &[&str], value: &Value) {
    if path.is_empty() {
        return;
    }

    let current = path[0];

    if path.len() == 1 {
        // 最后一个路径部分
        if let Some((key, index)) = parse_array_key(current) {
            let array = map.entry(key).or_insert(Value::Array(vec![]));
            if let Value::Array(vec) = array {
                while vec.len() <= index {
                    vec.push(Value::Null);
                }
                vec[index] = value.clone();
            }
        } else {
            map.insert(current.to_string(), value.clone());
        }
        return;
    }

    // 不是最后一个路径部分
    if let Some((key, index)) = parse_array_key(current) {
        let array = map.entry(key).or_insert(Value::Array(vec![]));
        if let Value::Array(vec) = array {
            while vec.len() <= index {
                vec.push(Value::Object(serde_json::Map::new()));
            }
            if let Value::Object(ref mut obj) = vec[index] {
                insert_into_map(obj, &path[1..], value);
            }
        }
    } else {
        let next_map = map.entry(current).or_insert(Value::Object(serde_json::Map::new()));
        if let Value::Object(ref mut obj) = next_map {
            insert_into_map(obj, &path[1..], value);
        }
    }
}

pub fn unflatten_json(flat_map: &HashMap<String, Value>) -> Value {
    let mut result = serde_json::Map::new();

    for (path, value) in flat_map {
        let parts: Vec<&str> = path.split('.').collect();
        insert_into_map(&mut result, &parts, value);
    }

    Value::Object(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_unflatten_simple_object() {
        let mut flat = HashMap::new();
        flat.insert("name".to_string(), json!("John"));
        flat.insert("age".to_string(), json!(30));

        let unflattened = unflatten_json(&flat);
        let expected = json!({
            "name": "John",
            "age": 30
        });
        assert_eq!(unflattened, expected);
    }

    #[test]
    fn test_unflatten_nested_object() {
        let mut flat = HashMap::new();
        flat.insert("user.name".to_string(), json!("John"));
        flat.insert("user.address.city".to_string(), json!("New York"));
        flat.insert("user.address.zip".to_string(), json!("10001"));

        let unflattened = unflatten_json(&flat);
        let expected = json!({
            "user": {
                "name": "John",
                "address": {
                    "city": "New York",
                    "zip": "10001"
                }
            }
        });
        assert_eq!(unflattened, expected);
    }

    #[test]
    fn test_unflatten_array() {
        let mut flat = HashMap::new();
        flat.insert("users[0].name".to_string(), json!("John"));
        flat.insert("users[0].age".to_string(), json!(30));
        flat.insert("users[1].name".to_string(), json!("Jane"));
        flat.insert("users[1].age".to_string(), json!(25));

        let unflattened = unflatten_json(&flat);
        let expected = json!({
            "users": [
                {
                    "name": "John",
                    "age": 30
                },
                {
                    "name": "Jane",
                    "age": 25
                }
            ]
        });
        assert_eq!(unflattened, expected);
    }

    #[test]
    fn test_unflatten_mixed_types() {
        let mut flat = HashMap::new();
        flat.insert("info.numbers[0]".to_string(), json!(1));
        flat.insert("info.numbers[1]".to_string(), json!(2));
        flat.insert("info.data.name".to_string(), json!("test"));
        flat.insert("info.data.active".to_string(), json!(true));

        let unflattened = unflatten_json(&flat);
        let expected = json!({
            "info": {
                "numbers": [1, 2],
                "data": {
                    "name": "test",
                    "active": true
                }
            }
        });
        assert_eq!(unflattened, expected);
    }
}
